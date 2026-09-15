/**
 * The services the Continental offers.
 *
 * Shared by the form and the route handler so the options a visitor can pick
 * and the values the server will accept can never drift apart. Same idea as the
 * room registry: one list, several consumers.
 */

export interface Service {
  id: string;
  label: string;
  /** Shown under the label while the option is selected. */
  note: string;
}

export const SERVICES: readonly Service[] = [
  {
    id: "creative-director",
    label: "Creative Director",
    note: "Creative vision, concepts, and direction for your project.",
  },
  {
    id: "brand-director-designer",
    label: "Brand Director / Brand Designer",
    note: "Brand strategy, visual identity, and design direction.",
  },
  {
    id: "digital-web-developer",
    label: "Digital Developer / Web Developer",
    note: "Websites, digital experiences, and development.",
  },
  {
    id: "video-producer-editor",
    label: "Video Producer / Video Editor",
    note: "Video production, editing, and post-production.",
  },
  {
    id: "talent-manager",
    label: "Talent Manager",
    note: "Talent representation, bookings, and coordination.",
  },
  {
    id: "project-manager",
    label: "Project Manager",
    note: "Project planning, timelines, and team coordination.",
  },
  {
    id: "technical-director-streaming-engineer",
    label: "Technical Director / Streaming Engineer",
    note: "Live streaming, broadcast systems, and technical direction.",
  },
  {
    id: "production-manager-coordinator",
    label: "Production Manager / Production Coordinator",
    note: "Production logistics, scheduling, and crew coordination.",
  },
];

export const isServiceId = (value: string) =>
  SERVICES.some((service) => service.id === value);
