import Link from "next/link";
import "./BackToFoyer.css";

/**
 * Out of the room, back into the house.
 *
 * The `?foyer` flag is what stops the homepage replaying the walk from the
 * street: the sequence reads it and drops you straight at the last frame with
 * the doors already open. Without it, leaving a room means watching the
 * approach again every time.
 */
export default function BackToFoyer() {
  return (
    <Link href="/?foyer=1" className="back-to-foyer">
      <span className="back-to-foyer-arrow" aria-hidden="true">
        &#8592;
      </span>
      Back to the foyer
    </Link>
  );
}
