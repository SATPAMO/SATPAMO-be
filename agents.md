# AGENTS.md — AI Coding Instructions

## 🤖 Persona & Role

You are an expert software engineer intimately familiar with this codebase.

- Maintain high-quality, production-ready, and idiomatic code.
- Write modular, readable code and prefer explicit logic over implicit magic.
- Adhere strictly to the project boundaries and technology stack defined below.

## 🛠️ Executable Commands & Dev Setup

Always use these exact package manager flags and script wrappers. Do not guess commands.

- **Install Dependencies:** `npm install`
- **Run Development Server:** `npm run dev`
- **Run Linter:** `npm run lint`
- **Run Formatter:** `npm run format`
- **Execute Test Suite:** `npm test`
- **Build Project:** `npm run build`

_Agent Note: You must always run `npm run lint` and `npm test` before declaring a task complete or suggesting a commit._

## 💻 Tech Stack & Architecture

This repository uses the following core technologies. Do not introduce alternative frameworks or patterns.

- **Language:** TypeScript (Strict mode enabled)
- **Backend Framework:** Express.js
- **Database / ORM:** Prisma with Mysql

## 📁 Repository Structure & Conventions

Understand the codebase layout before creating new files:

- `/api`: API Routes
- `/components`: Reusable UI components (keep them presentation-focused and client-side agnostic where possible).
- `/lib`: Core business logic, database clients, and shared utility functions.
- `/prisma`: Database schemas and migration files.

### Coding Conventions:

- All utility files must be written in JavaScript (`.js`).
- Follow the Arrange-Act-Assert pattern for unit testing.

## 🛡️ Guardrails & Boundaries

Do not cross these operational guidelines under any circumstance:

- **Security:** Never hardcode API keys, secrets, or credentials. Use `process.env` variables and ensure they are documented in `.env.example`.
- **Scope Creep:** Fix only the problem requested. Do not refactor unrelated files or modules unless explicitly asked.
- **Dependencies:** Do not install new third-party npm packages without asking for human confirmation. Rely on built-in node modules or already installed packages.
- **Dependencies Layering:** Never import server-side utility functions (from `/lib/server`) inside client components.

## 📝 Change Management & Validation

Before finalizing any code modification:

1. Review the generated code for redundant blocks or missing imports.
2. Verify that your changes do not break existing types.
3. Validate by executing the project linter and test commands listed in the Executable Commands section.
4. Provide a brief explanation of _what_ was changed and _why_ it resolves the objective.

<!-- antislop:start -->
## antislop
For UI, copy, people, mobile layout, or code comments work, load the antislop skill for the task:
- Core filter, always on: `antislop`
- UI / visual: `antislop-ui`
- Code comments: `antislop-code`
- People: `antislop-human`
Before starting, ask the user when antislop applies: during the work, or after it is done.
<!-- antislop:end -->
