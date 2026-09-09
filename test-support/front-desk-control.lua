-- Run the unmodified production Lua with an in-memory redis.call boundary.
-- This validates Lua semantics, NOT a live Redis service or real concurrency.
local program = assert(load(io.read('*a')))
local data, expires, encoded, serial, now = {}, {}, {}, 0, 1000000
local function copy(v)
  if type(v) ~= 'table' then return v end
  local out = {}; for k, value in pairs(v) do out[k] = copy(value) end; return out
end
cjson = {
  encode = function(v) serial = serial + 1; local id = 'json-' .. serial; encoded[id] = copy(v); return id end,
  decode = function(v) assert(encoded[v], 'invalid encoded fixture'); return copy(encoded[v]) end
}
local function get(k)
  if expires[k] and expires[k] <= now then data[k] = nil; expires[k] = nil end
  return data[k]
end
local function collection(k) local value = get(k); if not value then value = {}; data[k] = value end; return value end
redis = { call = function(cmd, key, a, b, c)
  if cmd == 'GET' then return get(key) end
  if cmd == 'SET' then data[key] = a; expires[key] = b == 'PX' and now + tonumber(c) or nil; return 'OK' end
  if cmd == 'PEXPIRE' then expires[key] = now + tonumber(a); return 1 end
  if cmd == 'EXISTS' then return get(key) and 1 or 0 end
  if cmd == 'ZADD' then collection(key)[b] = tonumber(a); return 1 end
  if cmd == 'ZSCORE' then local v = collection(key)[a]; return v and tostring(v) or nil end
  if cmd == 'ZCARD' then local n = 0; for _ in pairs(collection(key)) do n = n + 1 end; return n end
  if cmd == 'ZREM' or cmd == 'SREM' then collection(key)[a] = nil; return 1 end
  if cmd == 'SADD' then collection(key)[a] = true; return 1 end
  if cmd == 'ZREMRANGEBYSCORE' then for k, value in pairs(collection(key)) do if value <= tonumber(b) then data[key][k] = nil end end; return 1 end
  error('unsupported fixture command: ' .. cmd)
end }
local function run(op, token, epoch, requestId, inbound)
  KEYS = { 'control', 'leases', 'active', 'journal:' .. (requestId or '') }
  ARGV = { op, token or '', tostring(now), tostring(epoch or -1), '90000', '172800000', 'guest-id', 'journal', requestId or '', 'accepted', tostring(inbound or -1) }
  return program()
end
local function state() return cjson.decode(run('view')) end
data.control = cjson.encode({ mode = 'ai', epoch = 0 })
assert(run('begin_ai', 'ai-a') == '0')
assert(run('begin_ai', 'ai-b') == '0')
assert(run('check_ai', 'ai-a', 0) == 'ok')
assert(cjson.decode(run('takeover')).mode == 'pausing')
assert(expires.control == nil, 'human controls must not expire')
assert(run('check_ai', 'ai-a', 0) == 'denied')
assert(run('begin_ai', 'new-ai') == 'paused')
assert(run('begin_reply', 'human-a', 1, 'send-1') == 'stale_state')
run('release', 'ai-a'); assert(state().mode == 'pausing')
run('release', 'ai-b'); assert(state().mode == 'human')
assert(run('begin_reply', 'human-a', 1, 'send-1') == 'ok')
assert(run('begin_reply', 'human-b', 1, 'send-1') == 'duplicate')
assert(run('begin_reply', 'human-b', 1, 'send-2') == 'busy')
assert(run('begin_close', 'human-b', 1, nil, 3) == 'busy')
assert(run('complete_reply', 'human-a', 1, 'send-1') == 'ok')
assert(run('begin_close', 'closer', 1, nil, 2) == 'new_messages_arrived')
assert(run('begin_close', 'closer', 1, nil, 3) == 'ok')
assert(run('begin_ai', 'arriving') == 'paused')
assert(run('complete_close', 'closer', 1, nil, 3) == 'new_messages_arrived')
assert(state().mode == 'human'); run('release', 'closer')
assert(run('begin_close', 'closer2', 1, nil, 4) == 'ok')
assert(run('complete_close', 'closer2', 1, nil, 4) == 'ok')
assert(state().mode == 'ai' and state().epoch == 2)
assert(expires.control == now + 172800000)
assert(run('begin_reply', 'old-tab', 1, 'send-3') == 'stale_state')
assert(run('begin_ai', 'expired-ai') == '2')
assert(cjson.decode(run('takeover')).mode == 'pausing')
now = now + 90001
assert(state().mode == 'human')
assert(run('check_ai', 'expired-ai', 2) == 'denied')
now = now + 172800001
assert(state().mode == 'human', 'TTL must not release a human hold')
print('control Lua invariants passed')
