// Which applications a pasted email names, decided by code before Claude
// reads it, so Claude gets the earlier emails of just those roles.
import { normalizeCompany } from "@/lib/jobs/companies";

/**
 * The roles whose company the text names as whole words, compared the way
 * company names are elsewhere: no case, accents, punctuation or legal suffix.
 */
export function rolesNamedIn<R extends { company: string }>(
  text: string,
  roles: readonly R[],
): R[] {
  const words = ` ${normalizeCompany(text)} `;
  return roles.filter((role) => {
    const name = normalizeCompany(role.company);
    return name.length >= 2 && words.includes(` ${name} `);
  });
}
