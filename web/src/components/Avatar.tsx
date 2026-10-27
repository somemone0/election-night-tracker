import { memo } from "react";
import { headshotOf, initials } from "../lib/headshots";

/** Round headshot for the results panel; initials when there is no photo. */
export const Avatar = memo(function Avatar({ name, size = 22 }: { name: string; size?: number }) {
  const src = headshotOf(name);
  return (
    <span className="av" aria-hidden="true" style={{ width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.42)) }}>
      {src ? <img src={src} alt="" width={size} height={size} loading="lazy" /> : initials(name)}
    </span>
  );
});

/** Square photo tile for the map cards. */
export const Tile = memo(function Tile({ name, lead }: { name: string; lead?: boolean }) {
  const src = headshotOf(name);
  return <span className={"pt" + (lead ? " lead" : "")} title={name}>{src ? <img src={src} alt="" loading="lazy" /> : initials(name)}</span>;
});
