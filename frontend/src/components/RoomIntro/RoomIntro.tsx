import "./RoomIntro.css";

interface RoomIntroProps {
  eyebrow: string;
  heading: React.ReactNode;
  copy?: string;
}

/**
 * The title block for a room whose composition is symmetrical.
 *
 * The office gets a side column because its subject — the desk — sits centre
 * frame and would be covered by anything placed over it. The wardrobe and the
 * library are built around a mirror and a fireplace on the centre line, so
 * their copy sits low and centred instead, on the floor wash, where it reads as
 * a caption to the room rather than a panel dropped on top of it.
 */
export default function RoomIntro({ eyebrow, heading, copy }: RoomIntroProps) {
  return (
    <div className="room-intro">
      <span className="room-intro-eyebrow">{eyebrow}</span>
      <h1 className="room-intro-heading">{heading}</h1>
      {copy && <p className="room-intro-copy">{copy}</p>}
    </div>
  );
}
