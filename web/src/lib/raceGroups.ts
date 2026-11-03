import type { CardSpec } from "./cards";
import { S } from "../strings";

/** Keep every ballot race available; RTM is listed once, in its own group. */
export function raceGroups(cards: CardSpec[]) {
  const groups = [
    { key: "berkeley", title: S.raceGroups.berkeley, cards: [] as CardSpec[] },
    { key: "measures", title: S.raceGroups.measures, cards: [] as CardSpec[] },
    { key: "state", title: S.raceGroups.state, cards: [] as CardSpec[] },
    { key: "rtm", title: S.raceGroups.rtm, cards: [] as CardSpec[] },
  ];
  for (const card of cards) {
    const index = card.key.startsWith("rtm-") ? 3 : card.scope === "state" ? 2 : card.measure ? 1 : 0;
    groups[index].cards.push(card);
  }
  return groups.filter(group => group.cards.length);
}
