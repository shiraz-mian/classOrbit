# ClassOrbit and Marketplace

Two independent full-stack applications, each with its own source code, automated tests, dependencies, and setup guide.

## Clone the repository

```sh
git clone https://github.com/shiraz-mian/classOrbit.git
cd classOrbit
```

## Choose a project

| Project        | Folder         | Setup instructions                         | Verification                   |
| -------------- | -------------- | ------------------------------------------ | ------------------------------ |
| Marketplace    | `marketplace/` | [Marketplace setup](marketplace/README.md) | `npm run verify`               |
| ClassOrbit LMS | `classorbit/`  | [ClassOrbit setup](classorbit/README.md)   | `npm test` and `npm run build` |

Run installation, startup, and verification commands inside the chosen project folder. The projects have separate dependency files and databases. With the default settings, run one project at a time because both frontends use port 5173 and both use Redis on port 6379.

## Repository structure

```text
marketplace/
  client/             React application and frontend tests
  server/             API, backend tests and integration tests
  scripts/            Verification commands
  README.md           Marketplace setup guide
classorbit/
  client/             React application
  server/
    src/              API and background processing
    prisma/           Database schema and migrations
    tests/            Automated tests
  scripts/            Development and integration verification
  README.md           ClassOrbit setup guide
.github/workflows/    Separate checks for both projects
```

## Environment files

Create environment files from each project's `.env.example` as described in its setup guide. ClassOrbit uses `classorbit/.env`; Marketplace uses `marketplace/server/.env`. Credentials, dependencies, uploads, build output, and generated verification artifacts are excluded from Git.
