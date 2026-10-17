# Edmate PRD v0.3

Oct 17, 2026 (country-neutral update) · @siddhant lahoti · Repo copy of the Claude Doc "Edmate PRD v0.3" (the doc has the diagrams and comments; this file is what agents read). v0.2 is in `docs/archive/`.

## TL;DR and vision

Edmate helps a student find the right teacher and learn with that teacher's AI agent every day, while the teacher teaches live only once or twice a month.

- **For teachers:** anyone who knows a subject uploads what they know (notes, videos, slides, links, their way of explaining). Edmate builds their teaching agent from it.
- **Packages:** the teacher sells packages. Each package decides what the agent knows and what it can do for the student.
- **For students:** a student subscribes to a teacher, picks a package, and gets that teacher's agent for as long as they stay subscribed.
- **A partner, not a chatbot:** the agent teaches only from the teacher's material, makes the student think instead of handing out answers, remembers each student's progress, and tells the teacher where students are stuck before each live class.
- **Not a school product:** no classrooms and no institutions. It is one student choosing one teacher for their own learning journey.

**Vision:** every student can learn from the teacher who suits them, with that teacher's guidance there every day, not only in class.

**MVP target (proposed):** a teacher with no technical skills goes from uploads to a live agent with two packages in one afternoon, and their first subscribers keep learning with it week after week.

**What changed from v0.2:** v0.2 was a free, school-based life-skills harness run by facilitators. v0.3 is a subscription platform where independent teachers build their own agents for any subject. The harness design (teaching modes, guardrails, learner memory, evals) carries over; the school, classroom and bring-your-own-key parts do not. Details are in *What changes from v0.2*.

## How it works

The teacher does the heavy work once (steps 1–3); after that, the agent teaches every day and the teacher joins live once or twice a month.

1. **Teacher uploads** notes, videos, slides, links and their way of explaining.
2. **Agent is built:** a course outline is drafted from the uploads; the teacher tests and fixes the agent.
3. **Packages are set:** each package = knowledge + skills + live classes + price. Then the agent goes live.
4. **Student subscribes:** finds the teacher, compares packages, picks one.
5. **Learns with the agent:** explanations, quizzes, feedback, only from their package.
6. **Monthly live class:** once or twice a month, planned from weekly insights. Recordings and the teacher's fixes improve the agent (loop back to step 1).

The agent and the live class feed each other: the agent's weekly insights shape the class, and class recordings and the teacher's corrections make the agent better.

## Problem and opportunity

Students learn best with a teacher who fits them, but good teachers can only be in one place at a time. An agent built from the teacher's own material can teach between classes; the risk is that "an AI tutor trained on your content" is already becoming a standard feature of creator platforms.

### The problem

- **For students:** recorded courses cannot answer back, tutors are costly and not there at night, and general chatbots teach from the whole internet, not from their teacher, sometimes wrongly.
- **For teachers:** one-to-one teaching does not scale, the same doubts repeat, and recorded courses often sit unfinished.
- **The evidence on AI tutors (cited in v0.2):** a plain chatbot raised practice scores but cut exam scores by 17% once removed; a tutor that gave hints instead of answers largely removed that harm ([Bastani et al., PNAS 2025](https://papers.ssrn.com/abstract=4895486)). A carefully designed AI tutor more than doubled learning gains in a physics trial ([Kestin et al., 2025](https://pmc.ncbi.nlm.nih.gov/articles/PMC12179260/)). How the agent teaches matters more than which model it uses.

### Who else is doing this

| Product | What it does | AI agent for students | Gap Edmate can fill |
| --- | --- | --- | --- |
| [Graphy](https://graphy.com/) (India) | Courses, memberships, communities, live sessions and coaching for creators; says 200,000+ creators | Yes: an [AI Avatar](https://graphy.com/ai-avatar) offering "personal tutoring, 24x7" from the creator's notes, lessons and FAQs | Its pages do not describe per-plan limits on what the Avatar knows, or teaching methods such as hints before answers and progress tracking |
| [Kajabi](https://www.kajabi.com/) (global) | Course, membership and coaching business platform | Yes: "Expert Agents", described as "AI teammates trained on your content" | A general creator business tool; not built for India, Indian pricing or Hindi |
| [Classplus](https://classplusapp.com/) (India) | Branded apps for coaching institutes and tutors ("Aapki Coaching Aapki App"): live classes, recorded lectures, tests | No AI tutor described on its home page | Built for coaching institutes, with doubts answered by people, not an always-on agent |
| [Delphi](https://venturebeat.com/ai/you-can-now-make-an-ai-clone-of-yourself-or-anyone-else-living-or-dead-with-delphi) (US) | AI "clones" of experts built from their writing, videos and audio (VentureBeat, Sep 2023) | A conversational clone, not a course | No packages, practice, feedback or progress |
| ChatGPT Study Mode, Gemini Guided Learning (cited in v0.2) | General study modes | Yes, but not from a chosen teacher | No teacher, no teacher's material, no live classes |

### What this means for Edmate

A 24x7 tutor from a creator's content is no longer new on its own; Graphy, the leading course platform for Indian creators, already sells one. Edmate needs an edge competitors don't show:

1. **Agent first, not course first.** The agent is the product and the teacher's partner, not a chat box added to a video course.
2. **Teaching that makes students think,** proven by evals on every agent: hints before answers, checks, and progress.
3. **Packages that truly lock knowledge and skills,** so teachers can sell clear tiers.
4. **The teacher stays in the loop:** weekly insights and live classes built around what students struggle with.

**Before building:** a hands-on test of Graphy's AI Avatar and Kajabi's Expert Agents, to check where they fall short.

## Who it is for

Two people matter most: the teacher who builds an agent and the student who subscribes to it.

| Persona | Who | Jobs to be done | Pains today | Edmate must deliver |
| --- | --- | --- | --- | --- |
| **Teacher (primary)** | Independent tutors, coaching teachers, college lecturers, working professionals who teach on the side (developers, designers, accountants), educators with a YouTube or Instagram following | Earn from what they know without teaching every day; reach more students; keep their teaching style and quality; know where students struggle | One-to-one teaching does not scale; recorded courses answer no questions; the same doubts come again and again | An agent built from their existing material in an afternoon; full control of packages; a clear view of student progress; payouts |
| **Student (primary)** | Self-driven learners: college students, exam and interview preparers, job seekers, professionals learning a new skill, hobby learners | Find a teacher whose style fits; clear doubts any time; stay on track; pay only for what they need | Recorded videos cannot answer back; general chatbots can be wrong and teach differently from the teacher; good tutors are costly and not there at night | That teacher's agent, any time; answers that match the teacher's material; progress remembered; clear packages and prices |
| Parent (secondary, only if under-18s are allowed) | Guardian of a minor learner | Consent; know what the child learns and who teaches them | Unknown teachers online; screen time | Verifiable consent, a view of teacher and progress |
| Edmate trust team (internal) | Edmate staff | Verify teachers, review reported content, handle refunds and disputes | — | Review queue, audit trail, takedown tools |

### Key user stories (MVP)

1. As a teacher, I upload my notes, 20 recorded lectures and a few links, and Edmate turns them into a course outline and an agent I can test.
2. As a teacher, I chat with my own agent as a student would, correct answers it gets wrong, and only then publish it.
3. As a teacher, I create a Free package (first three lessons, questions only) and a Full Course package (all material, practice and feedback), and set a monthly price for the second.
4. As a student, I find a teacher by subject, read their profile, try the Free package, then subscribe to Full Course.
5. As a student, I ask the agent to explain a concept again in simpler words, and it asks me questions until I can explain it back.
6. As a teacher, before my monthly live class I read a summary of what my subscribers struggled with, and plan the class around it.

## Teacher journey

A teacher goes from "I know this subject" to a live, paid agent in six steps, and stays in charge of it after launch.

1. **Sign up and get verified.** Name, subject, a short bio and photo, proof of identity, and a payout account.
2. **Bring what you know.** Upload notes (PDF, Docs, slides), recorded videos (transcribed automatically), links and YouTube videos they own, practice questions with answers, and a few sample explanations in their own words. A short interview with Edmate captures their teaching style: favourite examples, how strict they are, what mistakes students usually make.
3. **Shape the course.** Edmate drafts a course outline (modules, topics, the skills each one builds) from the uploads. The teacher reorders, renames, removes and fills gaps.
4. **Build and test the agent.** The teacher chats with their agent as a student would, marks wrong or off-style answers, and fixes them with a short correction. Edmate re-tests the agent on those questions before launch.
5. **Create packages and prices.** For each package, the teacher chooses which modules the agent may use, which skills it has (practice, feedback, mock interviews and so on), any live classes included, and a monthly price. A free package is optional.
6. **Publish.** The teacher's profile page goes live, with their packages, a sample conversation and reviews.

**After launch, every month:**

- Read the weekly insights: what subscribers asked most, where they got stuck, which answers they marked unhelpful.
- Run one or two live classes, planned around those insights; recordings can go back into the agent's knowledge.
- Update material, add modules, change packages; existing subscribers are told what changed.
- See earnings, subscribers and progress by package.

## Student journey

A student finds a teacher, subscribes, picks the package that fits, and then learns with that teacher's agent every day.

1. **Find a teacher.** Search or browse by subject, goal (an exam, a job, a skill) and language. Each teacher page shows their bio, teaching style, packages and prices, a sample conversation with their agent, and reviews.
2. **Try before paying.** If the teacher offers a free package, the student starts there with limited knowledge and skills.
3. **Subscribe and choose a package.** On subscribing, the student sees the teacher's packages side by side (what the agent knows, what it can do, live classes included, price) and picks one to start with.
4. **Learn with the agent.** Every day, in the student's own time:
   - ask doubts and get them explained in the teacher's way;
   - get questioned until they truly understand, with hints before answers;
   - practise with questions at the right level, and get feedback on their work;
   - use the package's special skills, such as a mock interview or a project review.
5. **Join live classes.** Once or twice a month, the teacher teaches live; the student can send questions in advance.
6. **See progress.** Topics covered, skills mastered, what to do next.
7. **Change plan.** Upgrade to unlock more right away, downgrade, pause, or cancel. On cancelling, access to the agent ends at the end of the paid period, and the student can download their notes and progress.

The agent always says it is an AI built from the teacher's material, never pretends to be the teacher, and tells the student when something is outside their package.

## Packages and access

A package is what a student buys: a set of the teacher's knowledge plus a set of the agent's skills, at a monthly price. The teacher designs every package; the student's subscription decides which ones their agent can use.

### What a teacher sets in each package

| Setting | What it controls | Example |
| --- | --- | --- |
| Knowledge | Which modules, notes, videos and question banks the agent may use | Modules 1–3 only |
| Skills | What the agent can do for the student | Explain, practice quizzes, code feedback |
| Help limits | How far hints go, and whether the agent may ever give a full solution | Hints up to a worked example; never the final answer to graded work |
| Usage limit | Messages per day, to keep AI cost predictable | 50 messages a day |
| Live classes | Which live classes are included | One a month |
| Price and period | Monthly price; optional free trial | Monthly, 7-day trial |

### Example: a Python teacher

|  | Free | Python Basics | Job Ready |
| --- | --- | --- | --- |
| Knowledge | First 3 lessons | All course notes and videos | Everything, plus interview notes and real project examples |
| Skills | Explain concepts | + practice questions, code feedback | + mock-interview role-play, project review |
| Live classes | — | — | Monthly live class |

### Skills a teacher can switch on (MVP)

Explain and clear doubts · question-led coaching (asks, does not tell) · practice quizzes at the right level · feedback on submitted work (answers, essays, code) · mock interview or viva role-play · revision notes and flashcards · study plan with weekly goals. Simulations, a code runner and voice follow in P1.

### Locked means locked

Students will try "pretend I'm on the premium plan" or "just summarise lesson 9". So locked material is kept away from the AI, not merely forbidden in its instructions.

*Diagram (in the Claude Doc): Student asks → **access filter** reads the student's package before any search or skill → only allowed material (e.g. Lessons 1–12, practice bank; not the locked interview notes) and allowed skills (explain, practice, code feedback; not the locked mock interview) reach the AI model → reply built only from allowed items, with sources.*

The filter runs before the AI sees anything, so there is nothing locked for a clever prompt to pull out.

1. **Every piece of material is tagged** with the packages that include it.
2. **Search is filtered first.** When the agent looks something up, it searches only material in the student's active packages, so locked material never reaches the AI and cannot leak.
3. **Skills are switched off, not hidden.** The agent is only given the skills in the student's packages; it cannot run any other.
4. **Changes apply at once.** An upgrade unlocks on the next message; a cancellation locks at the end of the paid period.
5. **The teacher chooses the reply to locked requests,** for example "That's in the Job Ready package" or "I can't help with that yet."
6. **Tested before release:** a "locked content" test suite tries to extract material from other packages; the target is zero leaks.
7. **Teachers can preview** the agent as a student on each package.

## The teacher's agent

The agent's job is to teach like this teacher, from this teacher's material, and to know when to say "ask your teacher". The harness designed in v0.2 does most of this work; the model behind it can be swapped.

### How it teaches

- **Makes the student think.** By default it asks before it tells, using a help ladder the teacher limits per package: a nudge → a hint → a worked example of a similar problem → a full solution (only after a real attempt, only if allowed).
- **Teaching modes** the teacher can use: question-led coach, explainer, practice, feedback on work, role-play (mock interview, viva, client conversation), and project coach.
- **Checks understanding.** Short checks at the end of a topic feed the student's progress.

### How it stays true to the teacher

- **Answers from the teacher's material first,** and shows where an answer came from ("from Lesson 4 notes"). If the material does not cover it, the agent says so instead of guessing, and can add the question to the teacher's list for the next live class.
- **Sounds like the teacher:** their examples, level of strictness and common warnings come from the style interview and sample explanations.
- **Teacher corrections stick.** When a teacher fixes an answer, that fix becomes part of the agent and a permanent test case.
- **Never pretends to be the teacher.** It is clearly labelled as an AI built from their material.

### What it remembers about each student

- Topics covered and skills mastered, the mistakes they repeat, their preferred language and level.
- A short summary of each session, so the next one picks up where they left off.
- Nothing about the student's personal life. Students can see and reset what the agent remembers.

### Harness layers carried over from v0.2

| Layer | What it does here |
| --- | --- |
| Context builder | Pulls the student's package material, profile and recent conversation into each turn |
| Access filter (new) | Limits search and skills to the student's active packages |
| Teaching policy | Picks the move (ask, hint, explain, check) and enforces the teacher's help limits |
| Intent router | Spots doubt, answer-seeking, off-topic, distress or misuse |
| Guardrails | Before: personal-data scrub, jailbreak and misuse checks. After: answer-leak, accuracy against the material, locked-content leak, tone |
| Learner memory | Progress and mistakes per student, per teacher |
| Evals | Teaching quality, accuracy, leak and safety tests on every agent before it goes live and after every change |
| Insights | Weekly teacher summary of what subscribers struggled with |

## Functional requirements

P0 ships in the MVP, P1 at public launch, P2 later. Each requirement names the test that proves it; numbers are proposed targets to confirm in the pilot.

### Teacher

| ID | Requirement | Acceptance test | Priority |
| --- | --- | --- | --- |
| T1 | Sign up, identity check and payout account | No agent can be published before the teacher is verified | P0 |
| T2 | Upload notes, PDFs, Docs, slides, links, owned YouTube videos and video files; videos are transcribed | A 60-minute lecture is searchable within 15 minutes of upload | P0 |
| T3 | Draft course outline from uploads; teacher edits it | Outline for 20 files in under 10 minutes; every topic links to its source files | P0 |
| T4 | Style interview and sample explanations shape the agent's voice | Teachers rate "sounds like me" 4/5 or higher in testing | P0 |
| T5 | Test the agent as a student, per package; correct wrong answers | A correction changes the next answer; each correction becomes a permanent test case | P0 |
| T6 | Package builder: knowledge, skills, help limits, usage limit, live classes, price, trial | Two packages created in under 15 minutes | P0 |
| T7 | Publish a profile page with packages and a sample conversation | Page live within 1 minute of publishing | P0 |
| T8 | Weekly insights: top questions, sticking points, unhelpful answers | Delivered every Monday; built from anonymised, aggregated conversations | P0 |
| T9 | Schedule live classes, attach them to packages, collect questions in advance | Subscribers on that package get the invite and a reminder; MVP may use an external video link | P0 |
| T10 | Earnings, subscribers and progress by package | Numbers match the payments ledger | P0 |
| T11 | Update material and packages; subscribers are told what changed | Changes reach the agent within 15 minutes | P1 |
| T12 | Add live-class recordings to the agent's knowledge | Recording searchable within 15 minutes | P1 |
| T13 | Coupons, bundles of teachers, cohort batches | — | P2 |

### Student

| ID | Requirement | Acceptance test | Priority |
| --- | --- | --- | --- |
| S1 | Sign up with Google or phone number | Under 1 minute | P0 |
| S2 | Find teachers by subject, goal and language; teacher pages | Search returns results in under 1 second | P0 |
| S3 | Try a free package without paying | No payment details asked | P0 |
| S4 | Subscribe, compare packages side by side, pick one, pay by UPI or card | Paid in under 2 minutes; package unlocked on the next message | P0 |
| S5 | Chat with the agent: text, maths, code, photos of written work; sources shown | First words of a reply in under 2 seconds (p95) | P0 |
| S6 | Package skills: practice, feedback on work, mock interviews and others | Each skill passes its eval suite before release | P0 |
| S7 | Progress page: topics covered, skills mastered, next steps | Updates after every check | P0 |
| S8 | Upgrade, downgrade, pause, cancel; download notes and progress | Upgrade applies at once; cancellation at period end; export is complete | P0 |
| S9 | Join live classes and send questions in advance | Reminder 24 hours and 1 hour before | P0 |
| S10 | Works on phones and laptops (responsive website) | All student flows usable at 360 px width | P0 |
| S11 | Hindi and English; voice input and read-aloud | Teacher picks the languages per package | P1 |
| S12 | Ratings and reviews of teachers | Only paying subscribers can review | P1 |
| S13 | Native mobile app; WhatsApp reminders | — | P2 |

### Platform

| ID | Requirement | Acceptance test | Priority |
| --- | --- | --- | --- |
| P1 | Access filter: search and skills limited to the student's active packages | Zero leaks on the locked-content test suite, for every published agent | P0 |
| P2 | Subscriptions, renewals, refunds, teacher payouts, GST invoices | Ledger reconciles daily; payouts on schedule | P0 |
| P3 | Agent quality gate: accuracy, answer-leak, locked-content and safety tests before publish and after every change | Agents that fail cannot be published | P0 |
| P4 | Model gateway with Edmate-held keys, cost metering per teacher, package and student, usage caps | Every model call metered; caps stop gracefully | P0 |
| P5 | Safety: distress detection with helplines, report button, takedown | A report reaches the trust team within 5 minutes | P0 |
| P6 | Trust team console: teacher verification, content review, disputes | Every action audited | P0 |
| P7 | Retention and churn analytics per teacher | — | P1 |
| P8 | Teacher API and MCP server | — | P2 |

## Trust, safety and privacy

Students pay for a teacher they trust, so Edmate must make sure the agent is accurate, the teacher is real, the material is theirs to share, and student data stays private.

| Area | The risk | What Edmate does | By |
| --- | --- | --- | --- |
| Accuracy | The agent teaches something wrong under the teacher's name | Answers from the teacher's material with sources shown; says "not covered" instead of guessing; the quality gate tests every agent before publish and after every change; students can flag an answer | MVP |
| Copyright | A teacher uploads material they do not own (publisher PDFs, others' videos) | Teachers declare they hold the rights; a report-and-takedown process with a grievance contact per market (for example India's IT Rules 2021); repeat infringers removed | MVP |
| Teacher identity | Fake or misleading teachers | Identity check before publishing; credentials marked "self-declared" unless verified; reviews only from paying subscribers | MVP |
| Teacher's content | Teachers fear losing control of their material | The teacher owns it; Edmate uses it only for that teacher's agent; no training of models on it; export and delete at any time | MVP |
| Student privacy | Personal questions and mistakes are sensitive | No ads, no data sales; teachers see aggregated insights, not raw chats, unless a student chooses to share; personal details removed before any model call; data stored in the pilot market's region; deletion on request | MVP |
| Minors | Many markets require verifiable parental consent for children; India's DPDP Act 2023 and Rules 2025, for example, treat under-18s as children ([K&S Partners](https://ksandk.com/data-protection-and-data-privacy/childrens-data-protection-under-indias-dpdp-rules/)) | **Proposed: MVP is 18+ only.** Under-18s later, with parental consent and stricter teacher vetting | Later |
| Wellbeing | A student shares distress with the agent | Distress detection on every message; a caring reply with helplines from the student's market (for example Tele-MANAS 14416 in India); no companion behaviour; the agent never claims to be human | MVP |
| Regulated subjects | Investing, health or legal teachers' agents seen as giving personal advice | The agent teaches concepts, never personal advice; topic-specific disclaimers; Edmate reviews teachers in these subjects before publishing | MVP |
| Model providers | Student data used to train someone else's model | Edmate-held keys only on provider tiers that do not train on inputs | MVP |
| Payments and tax | Refunds, chargebacks, GST and tax on teacher payouts | A payment provider per market (for example UPI AutoPay in India, or a merchant of record that handles VAT/sales tax globally); clear refund policy; tax confirmed with an accountant in each market | MVP |

## Business model

Students pay teachers through Edmate; Edmate takes a share that covers AI cost, payments and the platform. Recommendation: a revenue share, with a floor price per package so AI cost is always covered. Exact percentages wait for real AI-cost data from the pilot.

| Option | How money flows | Good | Hard |
| --- | --- | --- | --- |
| **A. Revenue share (recommended)** | Teacher sets the price; Edmate keeps a percentage of each subscription and pays the teacher the rest | Teachers pay nothing up front; Edmate earns only when teachers do | Edmate carries AI cost, so heavy users of cheap packages can lose money → floor prices and usage caps |
| B. Teacher software fee | Teacher pays Edmate monthly (plus AI usage); keeps all subscription revenue | Predictable for Edmate | A barrier for new teachers with no students yet |
| C. Free start, then share | Free for a teacher's first few paying subscribers, revenue share after | Easy start for teachers | Edmate pays AI cost for the free period |
| D. All-access student plan | Students pay Edmate one fee for many teachers; teachers paid by usage | Simple for students | Hard to price; teachers lose control of pricing |

**AI cost is now Edmate's.** In v0.2, schools brought their own model keys. Here, Edmate holds the keys, so cost per active student is a core business number. Every package therefore has a usage limit, the package builder shows the teacher an estimated AI cost per subscriber, and cheaper models are used wherever the quality gate shows they are good enough.

**Open:** whether Edmate is a company, a social enterprise or stays non-profit (v0.2 said non-profit and free).

## Success metrics

The north star is **paying students still learning with their teacher's agent three months after subscribing**: it only grows when teachers build good agents and students actually learn with them. All targets are proposed for a pilot of about 20 teachers and 500 paying students.

| Category | Metric | Pilot target |
| --- | --- | --- |
| North star | Paying students still active after 3 months | ≥ 50% of those who subscribed |
| Learning habit | Subscribers who learn with the agent on 3 or more days a week | ≥ 40% |
| Learning | Students passing the end-of-module checks on their first or second try | ≥ 70% |
| Teacher setup | Time from first upload to a published agent with two packages | One afternoon (median under 4 hours) |
| Teacher success | Pilot teachers with 10 or more paying subscribers after 2 months | ≥ 50% |
| Teacher time | Live-class hours per teacher per month | 1–4 hours |
| Agent quality | Answers students flag as wrong or unhelpful | < 5% |
| Accuracy | Factual errors on each teacher's own question set | < 1% |
| Locked content | Leaks of material outside the student's package | 0 |
| Answer leaks | Full solutions given where the package forbids them | < 2% |
| Cost | AI cost per active student, as a share of their package price | ≤ 25% |
| Free to paid | Free-package users who subscribe within 30 days | ≥ 10% |

## Roadmap and MVP scope

Validate first, then build a narrow MVP, prove it with about 20 teachers and 500 paying students, and only then open sign-up to everyone. Dates follow once the open questions are answered.

| Phase | What happens | Gate to the next phase |
| --- | --- | --- |
| 1 · Validate | Try Graphy and Kajabi; talk to 20 teachers and 30 students; sign anchor teachers | 10+ teachers commit; open questions answered |
| 2 · Build the MVP | Agent + access filter, teacher studio, student web app, payments, trust console | Quality and locked-content tests pass |
| 3 · Pilot | About 20 teachers, about 500 paying students, 18+; measure 3-month use | North-star and cost targets met |
| 4 · Launch and grow | Open teacher sign-up, reviews, Hindi voice; later under-18s with consent, mobile app | — |

**MVP in:** teacher sign-up and verification, uploads with video transcription, course outline, agent testing and corrections, package builder with the access filter, teacher profile pages, student sign-up, discovery, free package, subscription and payment by UPI or card, the agent chat with the MVP skills, progress, live classes by external link, weekly teacher insights, the quality gate, safety and the trust console. Phone and laptop web, English first.

**MVP out (deliberately):** under-18 learners, native mobile apps, built-in video classes, Hindi voice, reviews, coupons and bundles, WhatsApp, teacher API, simulations and code runner.

## Risks and open questions

The biggest risk is the empty marketplace: students come for good teachers, and teachers come for students. The pilot should start with teachers who already have students and bring them along.

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Empty marketplace (no teachers, no students) | No growth | Recruit about 20 anchor teachers with an existing audience (tutors, YouTube and Instagram educators); each invites their own students first; open browsing later |
| Weak material makes a weak agent | Bad learning, refunds | The quality gate, "not covered" answers, and a gap report telling the teacher what to add |
| AI cost higher than the price | Losses on every active student | Usage limits, floor prices, cheaper models where the quality gate allows, cost shown to teachers |
| Teachers fear the agent replaces them | Few sign-ups | Teachers set everything; the agent sends hard questions back to them; live classes stay at the centre; more students per teacher, not fewer teachers |
| Copyright disputes over uploads | Legal and trust damage | Rights declaration, fast takedown, repeat-infringer removal |
| Big platforms or general chatbots add the same feature | Students go elsewhere | Edmate's edge: the teacher's own material and style, locked packages, and a real teacher behind the agent |
| A safety incident with a student | Severe | Distress detection with helplines, no companion behaviour, 18+ first, fast reporting |
| Regulated subjects (investing, health, law) | Regulatory risk | Concepts only, no personal advice; teachers in these subjects reviewed before publishing |

### Assumptions in this draft (correct me)

- A student subscribes to a teacher and holds **one package per teacher** at a time, switching by upgrade or downgrade; they can follow several teachers.
- **Country-neutral:** any subject, any market. Currency, language, helplines, payments, tax and privacy rules come from a locale pack per market. The pilot launches in one market, chosen by where the anchor teachers are. English in the MVP; more languages per market.

### Open questions for you

- [ ] Are the first learners **18+ only** (recommended), or school students too?
- [ ] Which subjects or kinds of teacher anchor the pilot (coding, exam prep, languages, professional skills)?
- [ ] Business model and Edmate's share; and is Edmate a company, a social enterprise or a non-profit?
- [ ] Do teachers see individual student conversations, or only aggregated insights unless the student shares?
- [ ] Live classes: built into Edmate, or a Google Meet or Zoom link in the MVP?
- [ ] Refund policy for students.
- [ ] Keep the name "Edmate"?

## What changes from v0.2

The teaching engine survives; almost everything around it changes. The build plan must be revised before task 0.1 starts, but the agent team that builds Edmate stays the same.

| Topic | v0.2 (15 Oct 2026) | v0.3 (this draft) | Status |
| --- | --- | --- | --- |
| Who it serves | Schools and NGOs; facilitators run classes | Independent teachers and the students who choose them | Changed |
| Setting | Classrooms, rosters, join codes | One student, one chosen teacher, online | Changed |
| Subjects | Four life-skills tracks written by Edmate and partners | Any subject; each teacher brings their own material | Changed |
| Money | Free, non-profit, no paid tiers | Paid subscriptions with packages; Edmate takes a share | Changed (open) |
| AI keys | Schools bring their own key | Edmate holds the keys and pays AI cost | Changed |
| Devices | Laptop first, school labs | Phone and laptop from day one | Changed |
| Ages | Grades 8–12 plus college | Proposed 18+ first | Changed (open) |
| Teaching engine | Modes, help ladder, guardrails, learner memory, evals | Same, plus the per-package access filter | Kept |
| Safety and privacy | DPDP, distress alerts, no ads, India data region | Same, plus copyright, teacher verification, payments | Kept and extended |
| Open source | MIT code, CC BY-SA content | MIT code; teachers own their content | Kept for code |
| Market | India only | Country-neutral; locale pack per market; one pilot market | Changed |

### Impact on the build plan

- **Reusable with little change:** foundations (M0), model gateway without the bring-your-own-key parts (M2), the turn pipeline (M3), guardrails (M4), search and tools (M5), learner memory (M6), evals (M7).
- **Redesigned:** core contracts (packages and subscriptions replace Spaces and classes), the data model (teachers, courses, packages, subscriptions, payments instead of orgs, schools and classes), sign-in (Google or phone instead of join codes), content (teacher uploads instead of Edmate tracks).
- **New milestones:** the teacher studio (upload, outline, test, packages), the student app and marketplace, payments and payouts, the trust console.
- **Dropped:** facilitator and school-admin views, school rostering, life-skills track content.

## Sources

Pages opened on 17 Oct 2026, unless marked as carried over from v0.2.

- [Graphy home page](https://graphy.com/): products for creators and adoption figures
- [Graphy AI Avatar](https://graphy.com/ai-avatar): "personal tutoring, 24x7", learns from creator content
- [Kajabi home page](https://www.kajabi.com/): Expert Agents, "AI teammates trained on your content"
- [Classplus home page](https://classplusapp.com/): "Aapki Coaching Aapki App"
- [VentureBeat: Delphi AI clones (Sep 2023)](https://venturebeat.com/ai/you-can-now-make-an-ai-clone-of-yourself-or-anyone-else-living-or-dead-with-delphi)
- [Bastani et al., Generative AI without guardrails can harm learning (PNAS 2025)](https://papers.ssrn.com/abstract=4895486), carried over from v0.2
- [Kestin et al., AI tutoring outperforms in-class active learning (2025)](https://pmc.ncbi.nlm.nih.gov/articles/PMC12179260/), carried over from v0.2
- [K&S Partners: children's data under India's DPDP Rules](https://ksandk.com/data-protection-and-data-privacy/childrens-data-protection-under-indias-dpdp-rules/), carried over from v0.2
