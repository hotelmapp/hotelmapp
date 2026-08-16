export const HOTEL_TIME_ZONE = "Asia/Taipei";
export const FRONT_DESK_HOURS = Object.freeze({ opens: "07:00", closes: "22:00" });

const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: HOTEL_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  weekday: "long", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
});

export class TemporalContextProvider {
  constructor({ now = () => new Date() } = {}) { this.now = now; }

  getContext() {
    const instant = this.now();
    const parts = Object.fromEntries(formatter.formatToParts(instant).filter(part => part.type !== "literal").map(part => [part.type, part.value]));
    const time = `${parts.hour}:${parts.minute}:${parts.second}`;
    const minutes = Number(parts.hour) * 60 + Number(parts.minute);
    return Object.freeze({
      timeZone: HOTEL_TIME_ZONE,
      instant: instant.toISOString(),
      date: `${parts.year}-${parts.month}-${parts.day}`,
      weekday: parts.weekday,
      time,
      frontDesk: { ...FRONT_DESK_HOURS, isOpen: minutes >= 7 * 60 && minutes < 22 * 60 }
    });
  }
}

export const temporalContextProvider = new TemporalContextProvider();

export function temporalContextPrompt(context = temporalContextProvider.getContext()) {
  return `Server temporal context (authoritative; do not infer the current time): ${context.date} ${context.weekday} ${context.time} (${context.timeZone}). Front desk 07:00–22:00 is currently ${context.frontDesk.isOpen ? "OPEN" : "CLOSED"}.`;
}
