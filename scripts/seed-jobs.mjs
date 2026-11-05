// Seeds made-up roles, for trying the tracker with a long list.
//
//   pnpm db:seed-jobs          adds 500 roles
//   pnpm db:seed-jobs 2000     adds 2,000
//   pnpm db:seed-jobs --remove deletes every seeded role again
//
// Seeded roles have a dedupe key starting with "seed:", so they never match a
// real posting, and --remove leaves real roles alone. Don't run it against a
// database you care about without --remove afterwards.
import { config } from "dotenv";
import pg from "pg";

config({ quiet: true });

// Varied enough to exercise every filter and sort: statuses, verdicts,
// scores (some missing), salaries in different periods (some missing),
// follow-ups in the past and future (some missing).
const SEED_SQL = `
with series as (
  select
    i,
    (array['Acme', 'Globex', 'Initech', 'Umbrella', 'Hooli', 'Stark Labs',
           'Wayne Tech', 'Soylent', 'Tyrell', 'Cyberdyne', 'Vandelay',
           'Pied Piper', 'Aperture', 'Black Mesa', 'Wonka Digital'])[1 + i % 15] as company,
    (array['Senior Frontend Engineer', 'Lead React Developer',
           'Senior Full-Stack Engineer (TypeScript)', 'Staff Engineer, Web',
           'Senior Angular Developer', 'Frontend Tech Lead',
           'Senior Next.js Engineer', 'Senior NestJS Engineer'])[1 + i % 8] as title,
    (enum_range(null::job_status))[1 + i % 11] as status,
    (enum_range(null::eligibility))[1 + i % 3] as eligibility,
    case when i % 7 = 0 then null else 20 + (i * 37) % 80 end as score,
    case when i % 5 = 0 then null else 40000 + (i * 1373) % 80000 end as salary_min,
    (array['year', 'month', 'hour'])[1 + i % 3] as period,
    case when i % 4 = 0 then current_date + (i % 21) - 10 else null end as follow_up
  from generate_series(1, $1::int) as i
)
insert into job (
  canonical_url, dedupe_key, company, title, facts, eligibility,
  eligibility_quote, eligibility_reasons, score, score_reasons, status,
  found_at, follow_up_on
)
select
  'https://example.com/jobs/seed-' || i,
  'seed:' || i,
  company,
  title || ' #' || i,
  jsonb_build_object(
    'company', company,
    'title', title,
    'summary', 'A made-up role for trying the tracker.',
    'location', jsonb_build_object(
      'workplace', 'remote', 'quote', 'Remote in Europe.',
      'allowed', jsonb_build_array('Europe'), 'placesAre', 'required',
      'excluded', jsonb_build_array()),
    'timeZones', jsonb_build_object(
      'quote', '', 'utcOffsetMin', null, 'utcOffsetMax', null),
    'salary', jsonb_build_object(
      'quote', '',
      'min', salary_min,
      'max', case when salary_min is null then null else salary_min + 15000 end,
      'currency', 'EUR',
      'period', period),
    'stack', jsonb_build_array('TypeScript', 'React'),
    'seniority', 'senior',
    'contract', 'full_time',
    'deadline', '',
    'applyUrl', '',
    'requirements', jsonb_build_array(),
    'applicationRules', jsonb_build_array(),
    'aiPolicy', ''),
  eligibility,
  'Remote in Europe.',
  '[]'::jsonb,
  score,
  case when score is null then null
       else jsonb_build_object('reasons', jsonb_build_array('Made up.'),
                               'gaps', jsonb_build_array()) end,
  status,
  now() - make_interval(hours => i),
  follow_up
from series
on conflict (dedupe_key) do nothing
`;

const arg = process.argv[2];
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

try {
  if (arg === "--remove") {
    const { rowCount } = await client.query(
      "delete from job where dedupe_key like 'seed:%'",
    );
    console.log(`Removed ${rowCount} seeded roles.`);
  } else {
    const count = Number(arg ?? 500);
    if (!Number.isInteger(count) || count < 1 || count > 100_000) {
      throw new Error("Give a number of roles from 1 to 100000.");
    }
    const { rowCount } = await client.query(SEED_SQL, [count]);
    console.log(`Added ${rowCount} seeded roles.`);
  }
} finally {
  await client.end();
}
