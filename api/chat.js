function extractResponseText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const textParts = (data?.output || [])
    .filter(item => item?.type === "message")
    .flatMap(item => item.content || [])
    .filter(part => part?.type === "output_text" && typeof part.text === "string")
    .map(part => part.text.trim())
    .filter(Boolean);

  return textParts.join("\n");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { message } = req.body || {};

    if (typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ error: "請輸入問題" });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "伺服器尚未設定 OpenAI API Key" });
    }

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-5-mini",
        instructions:
          "你是希堤微旅的 AI 智慧櫃台。請使用繁體中文，親切、簡潔地回答旅客問題。如果涉及訂房修改、退款、付款、設備故障或需要查詢飯店內部即時資料，請提醒旅客聯絡真人櫃台協助。",
        input: message.trim()
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error(data);
      return res.status(response.status).json({
        error: data?.error?.message || "OpenAI API 發生錯誤"
      });
    }

    const answer = extractResponseText(data);

    if (!answer) {
      console.error("OpenAI Responses API 未回傳 output_text", data);
      return res.status(502).json({ error: "OpenAI 未回傳有效內容" });
    }

    return res.status(200).json({ answer });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "系統暫時發生錯誤" });
  }
}
