// Keeps a built CV to the length the owner asked for. Claude is asked for
// about the right number of bullets; when the PDF still runs over, bullets
// go one at a time, from the oldest roles first, until it fits.
import type { CvContent } from "@/lib/schemas/tailor";

/** The two newest roles keep two bullets each for as long as anything else can go. */
const RECENT_ROLES = 2;

function withoutLast<T>(items: T[]): T[] {
  return items.slice(0, -1);
}

/**
 * The CV with one bullet fewer, or null when nothing more can go: older
 * roles lose bullets down to one each, then projects go, then the newest
 * roles lose bullets down to one each.
 */
export function dropOneBullet(content: CvContent): CvContent | null {
  const { experience, projects } = content;
  const minimum = (index: number) => (index < RECENT_ROLES ? 2 : 1);

  const fromRoles = (keep: (index: number) => number) => {
    for (let index = experience.length - 1; index >= 0; index -= 1) {
      if (experience[index].highlights.length > keep(index)) {
        return {
          ...content,
          experience: experience.map((role, at) =>
            at === index
              ? { ...role, highlights: withoutLast(role.highlights) }
              : role,
          ),
        };
      }
    }
    return null;
  };

  const older = fromRoles(minimum);
  if (older) return older;

  const last = projects.at(-1);
  if (last) {
    return {
      ...content,
      projects:
        last.highlights.length > 1
          ? [
              ...withoutLast(projects),
              { ...last, highlights: withoutLast(last.highlights) },
            ]
          : withoutLast(projects),
    };
  }

  return fromRoles(() => 1);
}

/** How many bullets and projects one CV has, to count what fitting left out. */
export function bulletCount(content: CvContent): number {
  return (
    content.experience.reduce((sum, role) => sum + role.highlights.length, 0) +
    content.projects.reduce(
      (sum, project) => sum + Math.max(1, project.highlights.length),
      0,
    )
  );
}

export type Fitted = {
  content: CvContent;
  bytes: Uint8Array;
  pages: number;
  /** Bullets and projects left out to fit. */
  trimmed: number;
};

/**
 * Draws the CV and, while it runs past `maxPages`, draws it again with one
 * bullet fewer. Stops when it fits or nothing more can go.
 */
export async function fitToPages(
  content: CvContent,
  maxPages: number,
  draw: (content: CvContent) => Promise<{ bytes: Uint8Array; pages: number }>,
): Promise<Fitted> {
  const start = bulletCount(content);
  let current = content;
  let drawn = await draw(current);
  while (drawn.pages > maxPages) {
    const shorter = dropOneBullet(current);
    if (!shorter) break;
    current = shorter;
    drawn = await draw(current);
  }
  return {
    content: current,
    ...drawn,
    trimmed: start - bulletCount(current),
  };
}
