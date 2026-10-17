# Edmate PRD — AI Harness for Teachers & Students

Oct 15, 2026 · @siddhant lahoti · Status: Draft v0.2 (India, life skills, BYOK)

Engineering build plan for the agent suite: Harness build plan

## TL;DR and vision

Edmate is a free, non-profit AI harness that teaches Indian students the life skills school skips — personal finance, AI literacy, entrepreneurship, marketing and more — through teacher-led, project-based learning. Teachers configure it, students learn by doing inside it, and every AI interaction is scoped, guarded and visible to the teacher. Schools and teachers bring their own model keys, so Edmate charges nothing.

**Vision:** every Indian student leaves school able to manage money, use AI well, and start something of their own — with an AI coach that makes them think and build, not copy.

**Decisions locked (Oct 2026):**

- **India first.** Hindi + English at launch, regional languages next. Laptop first: Edmate is a website used on laptops and desktops in school labs, NGO centres and homes; a phone-friendly view follows.
- **Life skills, not syllabus.** Not tied to CBSE or any board. Launch tracks: personal finance, AI literacy, entrepreneurship and business, marketing; more follow (see Curriculum).
- **Non-profit and free.** No paid tiers, no ads, no data sales.
- **Bring your own key (BYOK).** A school, NGO or teacher plugs in a Gemini, OpenAI, Claude, OpenRouter or Sarvam key; Edmate never resells model access.

**What makes Edmate different:**

- **A harness, not a chatbot.** Teacher-set context, tutoring that withholds answers, simulations and role-plays, per-class guardrails, learner memory and evals.
- **Learn by doing.** Every track ends in a real project: a family budget, a working AI tool, a micro-business, a campaign.
- **Teacher in the loop.** Teachers author Spaces, see transcripts and insights, and approve anything that becomes feedback.
- **Light platform.** One website with a facilitator view and a student view, six objects, works alongside Google Classroom.

**MVP target:** a teacher with no prior AI experience runs a 6-week personal-finance or AI-literacy track for a class in under 10 minutes of setup.

## Problem and market research

AI already saves teachers about six hours a week and can double learning gains, but only when it is built to teach. Used as a plain answer engine, it makes students score worse. That gap, between a guardrailed tutor and a raw chatbot, is the product.

### What the evidence says

- **Teachers gain real time, but adoption is shallow.** 6 in 10 US public-school teachers used AI last year, yet only 32% use it weekly and 40% not at all. Weekly users save 5.9 hours a week, about six weeks a school year ([Gallup–Walton Family Foundation, 2025](https://www.waltonfamilyfoundation.org/learning/six-weeks-a-year-how-ai-gives-teachers-time-back)).
- **Students are already using general chatbots.** 26% of US teens used ChatGPT for schoolwork in 2024, double 2023. Only 29% think it is fine for solving math problems ([Pew Research, Jan 2025](https://www.pewresearch.org/short-reads/2025/01/15/about-a-quarter-of-us-teens-have-used-chatgpt-for-schoolwork-double-the-share-in-2023/)).
- **Unguarded AI harms learning.** In a field experiment with \~1,000 high-school math students, a plain GPT-4 interface lifted practice scores 48% but cut exam scores 17% once removed. A tutor version with teacher-written hints and no direct answers lifted practice 127% and largely removed the harm ([Bastani et al., PNAS 2025](https://papers.ssrn.com/abstract=4895486)).
- **Well-designed AI tutors outperform good classrooms.** In a Harvard physics RCT (194 students), students using a pedagogy-scripted AI tutor learned more than twice as much in less time than in an active-learning class ([Kestin et al., Scientific Reports 2025](https://pmc.ncbi.nlm.nih.gov/articles/PMC12179260/)).

**Implication for Edmate:** the harness — teacher-supplied context, answer-withholding behaviour, step-by-step scaffolds and evals — is what turns a model into a learning gain. It is the core IP, not a feature.

### Competitive landscape

The market splits into four jobs: teacher productivity, supervised student AI, tutoring, and general study modes. Most players own one or two; none owns the teacher-configured harness end to end.

| Product | Primary job | What it does well | Gap Edmate exploits | Price (individual) |
| --- | --- | --- | --- | --- |
| [MagicSchool](https://www.magicschool.ai) | Teacher productivity | 80+ teacher tools, 50+ student tools, broad LMS/SSO integrations, SOC 2 | Tool sprawl; one-shot generators with little learner memory or pedagogy loop | Free; Plus \~$9.99–$12.99/mo |
| [SchoolAI](https://schoolai.com) | Supervised student AI | Teacher-built "Spaces", Mission Control dashboard, crisis flagging, FERPA/COPPA/SOC 2 | Thin teacher-workload tooling; limited cross-space learner model | Free; \~$12/mo |
| [Brisk](https://www.briskteaching.com/) | Teacher productivity in-flow | Chrome extension inside Docs, PDFs, video; claims 1 in 3 US teachers | No student tutoring space or learner model of its own | Free; Pro \~$8–$9.99/mo |
| [Khanmigo](https://www.khanmigo.ai/) | Tutoring | Socratic tutor tied to Khan content; free for teachers in 44+ countries | Locked to Khan curriculum; student access needs district deal | Free (teachers); \~$4/mo families |
| ChatGPT Study Mode / Gemini Guided Learning / [Claude Learning Mode](https://www.anthropic.com/news/introducing-claude-for-education) | General study modes | Free or cheap, frontier models, Socratic by default (launched 2025) | No teacher control, class context, rubric, or visibility; not built for under-13 | Free to \~$10/mo |

Prices from [Dupple's 2026 roundup](https://dupple.com/learn/best-ai-education-tools); confirm before pricing decisions.

None of the global players above target Indian classrooms or life-skills topics; the India picture follows.

### India: is anything like Edmate already here?

No one in India combines a teacher-controlled AI harness with a life-skills curriculum. AI in Indian education today is either syllabus and exam-prep tutoring, or teacher lesson-planning for board subjects. Life-skills learning exists, but as videos or NGO programmes without AI coaching.

| Player | Type | What it does | Scale | Gap Edmate fills |
| --- | --- | --- | --- | --- |
| [SwiftChat (ConveGenius)](https://frontiertech.niti.gov.in/story/this-digital-platform-is-using-ai-for-skill-development-in-indian-schools/) | Commercial, govt partner | App of AI chatbots (tutoring, reading, assessments) that states customise; started on WhatsApp | \~1.4 crore monthly users; in \~40% of schools | Board syllabus and foundational literacy; not life skills; little teacher authoring |
| [Shiksha Copilot](https://news.microsoft.com/source/asia/features/indias-schoolteachers-are-drafting-better-lesson-plans-faster-thanks-to-a-copilot) (Microsoft Research + Sikshana Foundation) | Research / non-profit | Turns textbook chapters into lesson plans in English and Kannada | Pilot: 30 teachers, 30 Karnataka schools | Teacher-only, students never touch it; textbook-bound |
| [Alakh AI (PhysicsWallah)](https://inc42.com/?p=446046) | Commercial edtech | AI Guru tutor, doubt engine, NCERT question generation; full AI tutor planned for 2026 ([Business Today](https://www.businesstoday.in/amp/technology/story/why-physicswallah-believes-it-can-beat-openai-google-in-indias-ai-tutor-race-534212-2026-06-01)) | 100M+ queries answered | JEE/NEET and board exams only |
| [OpenAI Learning Accelerator](https://www.storyboard18.com/digital/openai-to-provide-5-lakh-free-chatgpt-licences-to-indian-students-and-teachers-79617.htm) | Big tech | 5 lakh free ChatGPT licences for students and teachers with MoE, AICTE, IIT Madras (Aug 2025) | 500,000 licences | General chatbot: no class context, teacher view, or curriculum |
| [Gemini for Students (India)](https://www.businesstoday.in/amp/technology/news/story/students-in-india-can-get-free-gemini-ai-pro-plan-heres-how-to-get-it-484829-2025-07-16) | Big tech | Free Google AI Pro for a year for Indian students 18+ (2025 offer) | College students | 18+ only; no school or teacher layer |
| [Seekho](https://digitalterminal.in/trending/seekho-app-crosses-100-million-downloads-adds-2175-million-users-in-2025) | Commercial app | 3–5 minute videos on finance, business, Instagram growth, English, part-time income | 100M+ downloads, \~4M paid subscribers | Passive video, no practice, no coaching, no teacher |
| [Business Blasters / EMC (Delhi govt + Udhyam)](https://citizenmatters.in/delhi-government-schools-entrepreneurial-mindset-business-blasters/) | Govt + non-profit | Entrepreneurship Mindset Curriculum; students get ₹2,000 seed money to run real businesses, no exams | \~3 lakh students, 51,000 teams | No AI coach for planning, pitching or bookkeeping between classes |

**What this tells us:**

- **Demand for life skills is proven.** Seekho's biggest categories are part-time income, business and finance; Delhi's EMC got 3 lakh students running businesses.
- **Free frontier AI is arriving** (OpenAI licences, Gemini student offer), but as raw chatbots. Edmate's harness can sit on top of those same keys and turn them into teaching.
- **Partners, not competitors.** Udhyam, Sikshana and NGOs running life-skills programmes are natural first users: they have the curriculum and the classrooms, and lack an AI coach.

### The life-skills gap

- Only 24% of Indian adults were financially literate in S&P's global survey, which tested inflation, compound interest, diversification and numeracy ([Moneylife, 2015](https://www.moneylife.in/article/76-percentage-indian-adults-financially-illiterate-survey/44508.html)).
- Over 85% of Indian school teachers have never used an AI tool, and B.Ed. programmes require no AI training ([Education for All in India](https://educationforallinindia.com/ai-in-indian-school-education-challenges-curriculum-teacher-training/)), so Edmate must teach the teacher as well as the student.
- Students already learn these topics from YouTube and Instagram finfluencers with no one checking accuracy; Edmate gives them a guarded, teacher-visible alternative.

## Personas and jobs to be done

Facilitators and students are the primary users; the facilitator may be a school teacher, an NGO educator or a club mentor. Programme leads deploy Edmate and hold the model key; parents watch.

| Persona | Who | Top jobs to be done | Pains today | Edmate must deliver |
| --- | --- | --- | --- | --- |
| **Facilitator (primary)** | Teacher running a life-skills period, elective or club (grades 8–12); NGO educator; college placement or E-cell mentor | Run a finance, AI or business module they were never trained in; keep 40+ students doing hands-on work; show progress to the principal or funder | No curriculum or training for these topics; low AI confidence; large classes; no way to coach every team | Ready-made tracks they can run tomorrow, with a facilitator guide; AI Spaces they can see into; a weekly progress digest |
| **Student (primary)** | 13–18 in school; 18–22 in college or skilling programmes; mostly on a school-lab, NGO-centre or family laptop | Understand money, use AI tools, start a side business, grow on Instagram, get job-ready | Learns from finfluencers and reels with no one checking; English-only content; no one to practise with | A coach in Hindi or English that guides through projects, role-plays and simulations, remembers progress and is safe |
| **Programme lead (deployer)** | Principal, NGO programme manager, state or CSR programme officer | Launch a life-skills programme across schools; prove impact to funders; control cost | Vendor lock-in; no outcome data; AI cost uncertainty; DPDP compliance | One-click org setup, own model key with spending caps, outcome reports, DPDP-ready consent |
| **Parent (observer, P2)** | Guardian of a minor | Know what the child learns; help at home | Worried about scams, screen time and AI misuse | Consent flow, WhatsApp summary in their language |

### Key user stories (MVP)

1. As a facilitator, I pick the "Money Basics" track, choose 6 weeks and Hindi, and get session plans, activities and student Spaces ready to assign.
2. As a facilitator, I open the facilitator guide before class and the AI coaches me on the session's concept and how to run the activity.
3. As a student, I run a budget simulation for a family of four on ₹25,000 a month, and the coach questions my choices instead of fixing them.
4. As a student team, we pitch our snack-stall idea to an AI "investor" role-play and get tough questions back.
5. As a facilitator, I see which students have finished their project and which misconceptions the class shares ("thinks a credit card limit is income").
6. As a programme lead, I paste our Gemini key, set a monthly cap of ₹5,000, and onboard 20 schools via Google sign-in.

## Product principles

Seven rules settle trade-offs; when a feature conflicts with one, the principle wins.

1. **Learn by doing, then reflect.** Every module ends in something the student makes or decides: a budget, a pitch, a prompt, a campaign. The AI questions and coaches; it never does the project.
2. **Make students think, not copy.** Default to Socratic guidance and hints; final answers only when the facilitator allows it or after a genuine attempt.
3. **The facilitator is the author.** Students only meet AI inside a Space a facilitator assigned. Feedback is a draft until the facilitator approves it.
4. **Real Indian context.** Rupees, UPI, SIPs, GST, kirana stores, Instagram reels, local scams — not dollar examples translated.
5. **Educate, never advise.** Finance tracks teach concepts and decision-making; Edmate never recommends a specific stock, fund or loan.
6. **Free, open and key-agnostic.** No fees, no ads, no data sales; any model key works, and the cheapest one that meets quality is the default.
7. **Light and laptop-first.** A website that runs well on a 4 GB school-lab laptop over shared school internet; never asks a school to adopt an LMS.

## Curriculum: life-skills tracks

Edmate launches with four tracks of six weekly sessions each, all project-based and age-banded for grades 8–10, 11–12 and college. Each track ships with a facilitator guide, session plans, AI Spaces and a capstone project; facilitators can remix any of it.

| Track | Sample modules | Capstone project | Signature AI experience | Launch |
| --- | --- | --- | --- | --- |
| **Money Basics (personal finance)** | Needs vs wants; budgeting; saving and compounding; UPI, cards and credit; insurance; inflation; spotting scams and Ponzi schemes | A 12-month budget and savings plan for a real or fictional family | Budget and life-event simulator (job loss, wedding, medical bill) with a coach that questions choices | MVP |
| **AI Literacy** | What AI is and is not; prompting; checking AI for errors and bias; deepfakes and misinformation; using AI for study and work ethically | Build a no-code AI helper for a local problem and document its limits | "Catch the AI" exercises where students find planted mistakes | MVP |
| **Start Something (entrepreneurship and business)** | Finding problems; customers; pricing and costs; profit and loss; pitching; running a tiny business | Run a micro-business for 2 weeks, keep accounts, present results (modelled on Delhi's Business Blasters) | AI investor and customer role-plays; bookkeeping coach | P1 |
| **Get Noticed (marketing and digital presence)** | Brand and audience; content for Instagram and WhatsApp; ads basics; analytics; online safety and reputation | Plan and run a campaign for a student or local business | AI focus-group role-play that reacts to student content | P1 |
| Next: Career Ready, Civic and Legal Basics, Communication, Digital Safety | CVs, interviews, emailing; rights, RTI, consumer court; public speaking; privacy | — | Interview role-play; debate partner | P2 |

### How a session runs

1. **Hook (10 min, offline):** the facilitator opens with a story or scenario from the guide.
2. **Learn (15 min):** a short concept explainer, in class or in the student's Space.
3. **Do (20 min):** students work through a simulation, role-play or task in their Space, alone or in teams of 2–3 per laptop.
4. **Reflect (5 min):** a 3-question check and one reflection prompt feed the learner profile.
5. **Between sessions:** students continue the project with the AI coach; the facilitator gets a digest.

### Content sourcing and quality

- Track content is written by subject experts and partner NGOs, then reviewed by practising facilitators; the AI generates variations, not the core curriculum.
- Finance content is checked against RBI, SEBI and NCFE public material; every track has an accuracy eval suite.
- All content is released under a Creative Commons licence so other programmes can reuse it.

## The Edmate harness

The harness is everything between a user's message and a model call, and everything after: it assembles classroom context, applies a teaching policy, runs tools, checks the output, and learns about the student. Models are swappable; the harness is the product.

&#91;embedded content: Edmate harness · one student turn, end to end\]

A turn flows clockwise from the student to the reply; the teacher's Space config and the learner's memory shape every response, and every turn is traced into evals and teacher insights. A distress signal at the input guardrails skips the loop and alerts a named adult.

### Harness layers

| # | Layer | Responsibility | MVP scope |
| --- | --- | --- | --- |
| 1 | **Context builder** | Assembles each turn: Space config, teacher materials (retrieval), rubric, standards, learner profile, recent turns | RAG over uploaded PDFs, Docs, slides, links; Edmate life-skills competency map + India context packs (UPI, GST, SEBI rules) |
| 2 | **Pedagogy policy** | Picks the tutoring mode and how much help to give; withholds answers per teacher setting | 6 modes + a 4-step help ladder (below); versioned prompt packs per track |
| 3 | **Intent router** | Classifies each student turn: on-task, answer-seeking, off-topic, distress, misuse | Small fast model; routes distress straight to guardrails |
| 4 | **Orchestrator** | Agent loop: plan, call tools, call model, retry; model routing by task, cost and residency | Bring-your-own key: Gemini, OpenAI, Claude, OpenRouter, Sarvam or self-hosted open-weight, via one gateway with per-org spend caps |
| 5 | **Tools** | Retrieval, finance and business simulators, calculator (CAS), no-code AI builder sandbox, quiz builder, rubric grader, read-aloud | Retrieval, budget simulator, calculator, quiz, rubric grader in MVP |
| 6 | **Guardrails** | Pre: moderation, PII scrub, jailbreak detect. Post: answer-leak check, grounding check, age-appropriateness, math verification | All pre/post checks in MVP; crisis alert to teacher + counselor |
| 7 | **Learner memory** | Per-student mastery by skill, misconceptions, preferences; session summaries | Skill mastery + misconception tags; teacher can view and reset |
| 8 | **Observability and evals** | Trace every turn; offline eval suites gate any prompt or model change; online quality sampling | Pedagogy, leak, accuracy and safety suites as CI gates |
| 9 | **Insights** | Batches transcripts into class-level misconceptions, at-risk students and next-lesson suggestions | Nightly class digest |

### Tutoring modes and help ladder

Teachers choose a mode per Space; the policy layer enforces it on every turn.

- **Socratic coach** — asks, never tells; the default for concept work.
- **Simulation** — runs a scenario the student steers (a family budget through 12 months, a stall's first week of sales), introduces events, and debriefs the choices.
- **Role-play** — investor, customer, interviewer, bank agent, scam caller or focus group, with facilitator-set persona limits.
- **Project coach** — checks in on the capstone, asks for evidence, keeps a project log; never writes the deliverable.
- **Practice** — generates questions at the right level with worked feedback and spaced review.
- **Explainer** — explains a concept in Hindi or English with Indian examples, then checks understanding.

Help ladder (teacher sets the ceiling): 1. Nudge question → 2. Conceptual hint → 3. Worked example of a *similar* problem → 4. Step-by-step solution (only after an attempt, only if allowed).

### Teacher-side agents

The same harness powers teacher work, with the teacher's library as context:

- **Facilitator coach** — teaches the facilitator the session's concept in 5 minutes and rehearses the activity with them; built for teachers new to finance or AI.
- **Remixer** — adapts any session by age band, language (Hindi, English, then regional), time available and offline/online setting.
- **Assessor** — quizzes, reflection prompts and project rubrics; draft feedback for facilitator review.
- **Insights analyst** — answers "which teams haven't logged sales this week?" from Space data.

### Harness configuration is data, not code

Each Space compiles to a versioned config the runtime enforces, so behaviour is auditable and testable:

```json
{
  "space_id": "sp_8124",
  "track": "money_basics",
  "session": 3,
  "mode": "simulation",
  "scenario": "family_budget_25k",
  "competencies": ["FIN.BUDGET.2", "FIN.SAVING.1"],
  "materials": ["guide_mb_s3", "worksheet_mb_s3"],
  "rubric": "rb_budget_plan_v1",
  "help_ceiling": 3,
  "final_answers": "never",
  "languages": ["hi", "en"],
  "age_band": "13-15",
  "model_key": "org_key_default",
  "token_budget_per_student": 40000,
  "safety_profile": "minor"
}
```

## The light platform

The platform is one website with a facilitator view and a student view, six objects and a handful of integrations; anything a school already has stays where it is. A Track (a packaged course of sessions, Spaces and a capstone) is the unit facilitators pick.

### Core objects

| Object | What it is | Key fields | Owned by |
| --- | --- | --- | --- |
| **Org** | School or district | Model keys and spend caps, SSO, policies, age bands | Admin |
| **Class** | A section with a roster | Track, age band, language, facilitators, students (Google Classroom, CSV or join code) | Teacher |
| **Library** | A teacher's materials | Files, links, rubrics, generated resources; shareable to dept/school | Teacher |
| **Space** | A configured AI experience for students | Harness config (mode, materials, rubric, help ceiling, window) | Teacher |
| **Assignment** | A Space or resource pushed to a class with due date | Space ref, due, LMS link, completion, optional grade passback | Teacher |
| **Learner profile** | What Edmate knows about a student | Skill mastery, misconceptions, accommodations, language | System; teacher can view/edit |

### Facilitator view (website, laptop first)

Five tabs:

1. **Home** — today's session with its plan, a 5-minute "prep me" with the facilitator coach, and the weekly digest ("9 of 32 students think a credit-card limit is income; suggested 10-min activity").
2. **Tracks** — the track library: preview, pick age band, language and weeks, then assign. Remix any session or Space.
3. **Spaces** — builder for custom Spaces (mode → scenario or materials → guardrails → preview as student → assign) and a live monitor for each.
4. **Class** — roster, project tracker by team, competency heatmap, transcripts, feedback queue.
5. **Create** — one prompt box for anything else: activity, quiz, handout, poster, parent message.

### Student view (website, laptop first)

Deliberately minimal: my Spaces, the Space chat, my project, my progress.

- **Space chat** — text, voice input in Hindi or English, uploads or webcam photos of notebooks and receipts, read-aloud; a banner says what the Space is for and that the facilitator can see it.
- **Simulations** — scenarios with sliders and choices (spend, save, price) beside a spreadsheet-style budget or profit-and-loss sheet, using the room a laptop screen gives.
- **"Give me a hint"** — climbs the help ladder instead of asking for answers.
- **My project** — the capstone checklist, project log and team members.
- **My progress** — competencies, badges, a certificate per completed track.
- **No open chat.** Minors cannot start free-form AI chat outside a Space.

### WhatsApp channel (P2)

After the laptop launch, WhatsApp extends Edmate to students without regular laptop access. A WhatsApp number lets them join a Space by code, chat by text or voice note, and get session nudges; facilitators get the digest there too. Parents can opt in to a weekly summary.

### Admin console

Org setup, Google sign-in, **model keys** (add one or more providers, set a default, set monthly spend caps per org, school and student, see usage and cost), AI policy by age band, data retention, safety alert routing, and impact reports for funders.

### Integrations

| Integration | Why | Priority |
| --- | --- | --- |
| Google sign-in + Google Classroom | Most common school accounts in India; rostering and posting | P0 |
| Model providers via BYOK (Gemini, OpenAI, Anthropic, OpenRouter, Sarvam, self-hosted vLLM/Ollama) | Schools pay providers directly or use free tiers; no lock-in | P0 |
| CSV roster + join codes | Schools and NGOs without Google Workspace | P0 |
| WhatsApp Business API | Reach students and parents on their main app | P2 |
| Microsoft sign-in / Teams | Schools on Microsoft | P1 |
| DIKSHA content links | Point to free government content where it exists | P2 |
| LTI 1.3 (Moodle, Canvas) | Colleges and skilling programmes | P2 |
| MCP server | Facilitators' own AI assistants can read their Edmate tracks and class insights | P2 |

## Functional requirements

P0 ships in the MVP pilot, P1 in public launch, P2 later. Each requirement lists the acceptance test that proves it.

### Facilitator

| ID | Requirement | Acceptance criteria | Priority |
| --- | --- | --- | --- |
| F1 | Sign up with Google; create a class from Google Classroom, CSV or join code | Class ready in < 2 min; students join with a 6-character code | P0 |
| F2 | Track library: Money Basics and AI Literacy, each 6 sessions × 3 age bands × Hindi/English | Facilitator guide, session plans, Spaces and capstone per session; assign a whole track in one action | P0 |
| F3 | "Prep me": facilitator coach explains the session concept and rehearses the activity | Facilitators with no finance or AI background rate readiness ≥ 4/5 after prep | P0 |
| F4 | Space builder: mode (incl. simulation, role-play), scenario or materials, help ceiling, final-answer rule, window | First custom Space in < 10 min; preview as student before assigning | P0 |
| F5 | Live monitor: who is active, stuck, off-task; open any transcript | Updates within 10 s; safety flags inline | P0 |
| F6 | Weekly digest: shared misconceptions, project status by team, students needing help | Delivered by Monday 7 am IST; every claim links to transcripts | P0 |
| F7 | Remix any session by age band, language, time, offline/online | Learning objective preserved (eval-checked) | P1 |
| F8 | Project tracker and rubric feedback drafts for capstones | Facilitator approves before students see feedback | P1 |
| F9 | Start Something and Get Noticed tracks | Same package as F2 | P1 |
| F10 | Share remixed tracks with the community library (CC licence) | Copy with attribution | P2 |

### Student

| ID | Requirement | Acceptance criteria | Priority |
| --- | --- | --- | --- |
| S1 | Join by code or Google; see assigned Spaces and project | Works in current Chrome, Edge and Firefox on a 4 GB RAM laptop at 1366×768 | P0 |
| S2 | Chat in a Space with mode-enforced coaching | Answer-leak rate < 2% on red-team suite when final answers = never | P0 |
| S3 | Simulations with click-based choices and a budget sheet (budget, life events) | Fully operable by keyboard and mouse at 1366×768 | P0 |
| S4 | Role-play personas (investor, customer, scam caller) | Stays in persona and within facilitator limits on eval suite | P0 |
| S5 | Voice input and read-aloud, Hindi and English (laptop mic) | Speech recognition word error ≤ 15% on classroom test set | P0 |
| S6 | End-of-session check + reflection updates competencies | 3 items + 1 reflection, under 3 min | P0 |
| S7 | Low-bandwidth mode | Text session works at 100 kbps; under 1 MB data per session | P1 |
| S8 | Phone-friendly responsive view | All student flows usable at 360 px width | P1 |
| S9 | Certificates and badges per track | Verifiable link a student can share | P1 |
| S10 | Regional languages (Marathi, Tamil, Telugu, Bengali, Kannada) | Facilitator toggle per class | P2 |

### Programme lead and parent

| ID | Requirement | Acceptance criteria | Priority |
| --- | --- | --- | --- |
| A1 | Org setup with Google sign-in, schools, facilitators | NGO or school live in one day | P0 |
| A2 | BYOK: add provider keys, pick default model per task, set monthly spend caps per org, school and student | Keys encrypted, never shown again after entry; usage stops gracefully at cap with a facilitator notice | P0 |
| A3 | Safety alert routing (self-harm, abuse, threats) to named staff | Alert delivered < 5 min | P0 |
| A4 | Impact report for funders: reach, completion, competency gains | Export PDF/CSV by school and track | P1 |
| A5 | AI policy by age band (modes, open chat, retention) | Applies within 1 min | P1 |
| A6 | Parent consent where required, WhatsApp weekly summary | DPDP-compliant consent record | P1 |

## Safety, privacy and compliance

India's DPDP rules set the bar, and BYOK changes who processes what: the key owner (school or NGO) is the customer of the model provider, so Edmate must make data flows explicit at setup.

### Regulatory requirements

| Regime | Applies to | What Edmate must do | By |
| --- | --- | --- | --- |
| India DPDP Act 2023 + Rules 2025 | All users; under-18 are children | Verifiable parental consent for under-18 unless the school processes data only for its own educational activities; no tracking, behavioural monitoring for ads, or targeted ads to children ([K&S Partners](https://ksandk.com/data-protection-and-data-privacy/childrens-data-protection-under-indias-dpdp-rules/)) | Pilot |
| SEBI / RBI rules on investment advice and finfluencers | Finance tracks | Teach concepts only; no specific securities, funds or tips; disclaimers in every finance Space | Pilot |
| Model provider terms (BYOK) | Every key owner | Show which provider receives what data; require providers that allow under-18 use under the owner's terms; prefer zero-retention or paid tiers that exclude training | Pilot |
| IT Rules 2021 (intermediary duties) | User content and grievances | Grievance officer, takedown process | Public launch |
| GDPR / COPPA / FERPA | Users outside India | Not in scope until expansion | Later |

### Data commitments

- No ads, no data sales, no training on student data by Edmate.
- **BYOK caveat, stated plainly at setup:** model calls go to the key owner's provider under their terms. Free tiers of some providers may use inputs to improve models, so Edmate warns against free-tier keys for minors and recommends paid or zero-retention tiers.
- Student names and contact details are replaced with pseudonymous IDs before any model call.
- Keys encrypted at rest, scoped per org, never visible after entry, never logged.
- Default retention: transcripts 1 academic year, then deleted; programme leads can shorten.
- Data stored in India (Mumbai or Hyderabad region).
- Open source code so schools, NGOs and auditors can verify all of the above.

### Student safety

- **Crisis detection** on every student turn (self-harm, abuse, violence, exploitation): the AI responds with care and Indian helplines (e.g. Tele-MANAS 14416), and a named adult gets an alert within 5 minutes.
- **Never impersonates a human;** reminds students it is an AI when emotional reliance shows.
- **No companion behaviour** and no free-form chat outside Spaces for minors.
- **Scam role-plays are fenced:** the "scam caller" persona never asks for real OTPs, account numbers or personal details, and breaks character to teach if a student starts sharing them.
- **Money safety:** the coach never suggests real trading, betting, loan apps or crypto schemes; simulations use play money only.
- **Age-tiered profiles** (13–15, 16–17, 18+) set moderation thresholds and allowed modes.
- **Red-team suite** of jailbreaks, answer extraction and harmful finance prompts runs before every release, against each supported provider.

### Academic integrity

Edmate makes AI use visible rather than policing it. Teachers see the full transcript behind any work done in a Space, and the writing coach never generates student prose. Edmate does not ship an "AI detector": detectors misfire, especially on English-language learners.

## Non-functional requirements and tech stack

Because key owners pay for every token, model cost per student is a product requirement, not just an engineering one; and because there is no revenue, Edmate's own hosting must stay cheap enough for grants to cover.

| Area | Requirement |
| --- | --- |
| Model cost to key owner | ≤ ₹20 per active student per month on the default model mix; shown live in the admin console |
| Edmate hosting cost | ≤ ₹2 per active student per month (grant-fundable); self-hostable on one small VM for a single school |
| Latency | First token < 2 s p95 on school broadband; simulations render without a model call where possible |
| Devices | Laptops and desktops (Windows, ChromeOS, Linux lab PCs), 4 GB RAM, 1366×768 and up; current Chrome, Edge, Firefox; phone layout in P1 |
| Bandwidth | A lab of 40 laptops works on one shared 20 Mbps line; text sessions under 1 MB; images compressed on device; works on intermittent connections with retry |
| Availability | 99.5% during Indian school hours; failover to a second key if the owner adds one |
| Accessibility | WCAG 2.2 AA; voice-first option for low-literacy users; read-aloud everywhere |
| Localization | UI and tracks in Hindi and English at launch; 5 regional languages by P2 |
| Security | Google sign-in or join codes; RBAC; encrypted keys and data; tenant isolation; audit log |

### Reference stack

- **Open source:** core harness and apps under a permissive licence (MIT or Apache 2.0); content under CC BY-SA.
- **Frontend:** Next.js website with facilitator and student views, made responsive for phones in P1; WhatsApp bot (P2) on the same backend.
- **Backend:** TypeScript on Postgres (row-level tenant isolation) + Redis; object storage in an Indian region.
- **Model gateway:** one interface over Gemini, OpenAI, Anthropic, OpenRouter, Sarvam and OpenAI-compatible local servers (vLLM, Ollama); routing, prompt caching, per-org caps.
- **Speech:** provider speech APIs where the key allows; open models (e.g. AI4Bharat IndicConformer) for Indian languages when self-hosted.
- **Harness runtime:** versioned track and Space configs; agent loop with a tool registry; guardrails as pre/post hooks.
- **Evals:** per-track accuracy, leak, persona and safety suites run against every supported model, so a key owner can see which cheap models pass.

## Success metrics

The north-star metric is **students who complete a track with a finished capstone project**: it only grows when facilitators run tracks and students actually build. Targets are for the end of a one-term pilot.

| Category | Metric | Pilot target |
| --- | --- | --- |
| North star | Students completing a track with a capstone | ≥ 60% of enrolled |
| Learning | Pre/post competency gain on track assessment (e.g. budgeting, compounding, spotting AI errors) | +20 percentage points |
| Learning | Behaviour change self-report 4 weeks later (made a budget, used AI to check facts, sold something) | ≥ 40% of completers |
| Facilitator | Facilitators who run a second track | ≥ 50% |
| Facilitator | Setup time for a full track | < 10 min median |
| Facilitator | Readiness after "prep me" | ≥ 4 / 5 |
| Pedagogy quality | Answer-leak rate when final answers are disallowed | < 2% |
| Accuracy | Factual error rate on finance and AI eval sets | < 1% |
| Safety | Crisis alerts delivered within 5 min | 100% |
| Cost | Model cost per active student per month | ≤ ₹20 |
| Reach | Students in pilot | 2,000 across 10–20 schools or NGO centres |
| Ecosystem | Partner organisations deploying with their own key | ≥ 3 |

## Roadmap, MVP scope and sustainability

Ship a narrow MVP — Money Basics and AI Literacy in Hindi and English — with 2–3 partner NGOs and 10–20 schools, prove students finish projects and learn, then open it to anyone with a key.

&#91;embedded content: Edmate roadmap · 4 phases, 3 gates (proposed)\]

The pilot runs in the January–March term so results are ready before the new academic year starts in April; gates use the metrics in Success metrics.

### MVP: in and out

**In:** F1–F6, S1–S6, A1–A3; Money Basics and AI Literacy tracks; Socratic, simulation, role-play, project-coach and explainer modes; Hindi + English; Google sign-in, CSV and join codes; BYOK for Gemini, OpenAI, Anthropic and OpenRouter; Indian data region.

**Out (deliberately):** paid plans, phone layout (P1), WhatsApp channel (P2), regional languages, Start Something and Get Noticed tracks (P1), parent app, open student chat, LMS integrations, AI detection.

### Sustainability without revenue (deferred — revisit after the harness plan)

Edmate is free to use; the costs that remain are small and each has a payer.

| Cost | Who pays | Notes |
| --- | --- | --- |
| Model tokens | Key owner (school, NGO, CSR sponsor, or the facilitator) | Spend caps keep it predictable; cheaper models chosen per task by eval results |
| Edmate hosting and ops | Grants, CSR, model-provider education credits | Target ≤ ₹2 per active student per month; self-hosting available |
| Curriculum creation and review | Partner NGOs, volunteer experts, foundation grants | Content is CC-licensed, so partners can co-own it |
| Core team | Foundation grants; fiscal sponsor or Section 8 company | Open-source contributors extend the harness |

**Keys for those who have none:** many facilitators will not have a provider account. Programme leads or CSR sponsors can hold one org key and share capped access to their schools, and Edmate should apply for provider education-credit programmes on partners' behalf.

### Go-to-market

1. **Anchor partners:** pilot with life-skills NGOs and programmes that already run classes (for example entrepreneurship, financial literacy or digital skills programmes); they bring curriculum expertise and classrooms, Edmate brings the coach.
2. **Schools through partners:** principals adopt via a partner, then add their own facilitators.
3. **Open community:** open-source launch, a public track library, and a facilitator community on WhatsApp and YouTube.
4. **Proof:** an independent evaluation of competency gains during the pilot, published openly, to unlock grants and state partnerships.

## Risks and open questions

The biggest risk is BYOK friction: most Indian teachers have never used AI and have no provider account, so "bring your own key" can stop adoption at step one.

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Facilitators can't get or pay for a key | No usage | Org-level keys held by NGOs or CSR sponsors with per-school caps; step-by-step key setup in Hindi; apply for provider education credits; self-hosted open model option |
| Free-tier keys may let providers train on minors' data | Privacy harm, DPDP exposure | Warn at setup; recommend paid or zero-retention tiers for minors; strip PII before every call |
| Quality varies by model | Bad coaching on cheap models | Publish eval scores per model per track; block models that fail safety or leak suites |
| Finance content seen as advice, or inaccurate | Regulatory and trust risk | Concept-only curriculum, disclaimers, accuracy evals against RBI/SEBI/NCFE material, expert review |
| Facilitators untrained in the topics | Shallow sessions | "Prep me" coach, facilitator guides, short video walkthroughs, community of practice |
| No timetable slot for life skills | Low completion | Fit into existing life-skills, club, NSS or EMC periods; after-school and NGO centre use; self-paced student mode |
| Limited laptop access (lab slots, few home computers) | Students drop off | Team mode on one laptop, lab-period scheduling, save-and-resume, phone view in P1, offline hook activities |
| Grant funding runs out | Platform shuts down | Open source + self-hosting so partners can keep running it; lean hosting costs |
| Safety incident with a minor | Existential | Crisis detection + human alert, fenced role-plays, no companion features, incident runbook |

### Decided

- [x] Launch market: India first.
- [x] Model access: bring your own key; Edmate does not resell or pay for model usage.
- [x] Business model: non-profit and free; no paid tiers.
- [x] Curriculum: life skills not taught in school (finance, AI, business, marketing first), not board syllabus.

### Open questions

- [ ] Legal home: Section 8 company, trust, or a fiscal sponsor under an existing NGO?
- [ ] Which 2–3 partner organisations anchor the pilot, and who writes each track?
- [ ] Age range for MVP: grades 8–12 only, or college and skilling programmes too?
- [ ] Default recommended model and key arrangement for schools with no budget?
- [ ] Certificates: Edmate-issued, partner co-branded, or linked to an existing credential?
- [ ] Who runs the independent evaluation of the pilot?

## Sources

- [Gallup–Walton Family Foundation: Six weeks a year — how AI gives teachers time back (2025)](https://www.waltonfamilyfoundation.org/learning/six-weeks-a-year-how-ai-gives-teachers-time-back)
- [Pew Research: About a quarter of US teens have used ChatGPT for schoolwork (Jan 2025)](https://www.pewresearch.org/short-reads/2025/01/15/about-a-quarter-of-us-teens-have-used-chatgpt-for-schoolwork-double-the-share-in-2023/)
- [Bastani et al.: Generative AI without guardrails can harm learning (PNAS 2025)](https://papers.ssrn.com/abstract=4895486)
- [Kestin et al.: AI tutoring outperforms in-class active learning (Scientific Reports 2025)](https://pmc.ncbi.nlm.nih.gov/articles/PMC12179260/)
- [MagicSchool](https://www.magicschool.ai) · [SchoolAI](https://schoolai.com) · [Brisk Teaching](https://www.briskteaching.com/) · [Khanmigo](https://www.khanmigo.ai/)
- [Anthropic: Introducing Claude for Education (Apr 2025)](https://www.anthropic.com/news/introducing-claude-for-education)
- [TechCrunch: Google's Guided Learning vs ChatGPT Study Mode (Aug 2025)](https://techcrunch.com/2025/08/06/google-takes-on-chatgpts-study-mode-with-new-guided-learning-tool-in-gemini/)
- [Dupple: Best AI education tools 2026](https://dupple.com/learn/best-ai-education-tools)
- [NITI Aayog Frontier Tech: SwiftChat in \~40% of Indian schools](https://frontiertech.niti.gov.in/story/this-digital-platform-is-using-ai-for-skill-development-in-indian-schools/)
- [Microsoft: Shiksha Copilot for Indian teachers](https://news.microsoft.com/source/asia/features/indias-schoolteachers-are-drafting-better-lesson-plans-faster-thanks-to-a-copilot)
- [Inc42: PhysicsWallah's Alakh AI](https://inc42.com/?p=446046) · [Business Today: PhysicsWallah's AI tutor plans (Jun 2026)](https://www.businesstoday.in/amp/technology/story/why-physicswallah-believes-it-can-beat-openai-google-in-indias-ai-tutor-race-534212-2026-06-01)
- [Storyboard18: OpenAI's 5 lakh free ChatGPT licences in India (Aug 2025)](https://www.storyboard18.com/digital/openai-to-provide-5-lakh-free-chatgpt-licences-to-indian-students-and-teachers-79617.htm)
- [Business Today: Free Gemini AI Pro for Indian students (Jul 2025)](https://www.businesstoday.in/amp/technology/news/story/students-in-india-can-get-free-gemini-ai-pro-plan-heres-how-to-get-it-484829-2025-07-16)
- [Digital Terminal: Seekho crosses 100M downloads](https://digitalterminal.in/trending/seekho-app-crosses-100-million-downloads-adds-2175-million-users-in-2025)
- [Citizen Matters: Delhi's Entrepreneurship Mindset Curriculum and Business Blasters](https://citizenmatters.in/delhi-government-schools-entrepreneurial-mindset-business-blasters/)
- [Moneylife: S&P survey — 76% of Indian adults financially illiterate (2015)](https://www.moneylife.in/article/76-percentage-indian-adults-financially-illiterate-survey/44508.html)
- [Education for All in India: AI in Indian school education](https://educationforallinindia.com/ai-in-indian-school-education-challenges-curriculum-teacher-training/)
- [K&S Partners: Children's data under India's DPDP Rules](https://ksandk.com/data-protection-and-data-privacy/childrens-data-protection-under-indias-dpdp-rules/)
- [FTC: COPPA rule amendments (Jan 2025)](https://www.ftc.gov/news-events/news/press-releases/2025/01/ftc-finalizes-changes-childrens-privacy-rule-limiting-companies-ability-monetize-kids-data)
