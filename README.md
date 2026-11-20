# ClassOrbit

A learning management system with student, instructor and admin workspaces, courses, streaming lessons, live classes, quizzes, PDF certificates and instructor earnings. Payments use Razorpay Test mode.

Built with React, Node.js, Express, PostgreSQL, Prisma, Redis, BullMQ, FFmpeg, Socket.IO, WebRTC and Chart.js.

## Requirements

- Node.js 22 and npm.
- A PostgreSQL database. The setup below uses Neon.
- Docker Desktop with the Linux engine running for Redis and the FFmpeg video worker.
- Razorpay Test keys to test paid enrollment.

Clone the repository and install dependencies for both workspaces:

```sh
git clone https://github.com/shiraz-mian/classOrbit.git
cd classOrbit
npm ci
```

Run the remaining commands from the project root.

## Project structure

```text
client/
  public/          Static assets
  src/             React pages, components and styles
server/
  prisma/          Schema, migrations and seed entry point
  src/             API, services, repositories and background jobs
  tests/           Automated tests
scripts/           Development and integration verification commands
infra/aws/         S3 and CloudFront infrastructure template
uploads/           Local uploads and processed videos (generated)
.data/             Runtime data and verification output (generated)
.env.example       Environment template
compose.media.yaml Redis and video worker with your configured database
compose.yaml       Alternative complete local Docker stack
```

## Set up Neon PostgreSQL

### 1. Configure the environment

Copy `.env.example` to `.env` if `.env` does not already exist. Preserve an existing configured `.env` when updating this project.

In Neon's **Connect** dialog, copy the pooled connection string to `DATABASE_URL`. Disable pooling and copy the direct connection string to `DIRECT_URL`. Both must point to the same database and branch. Preserve Neon's TLS parameters and add `connect_timeout=15` if it is absent.

Set these values in the root `.env`:

```dotenv
DEMO_MODE=false
PORT=4000
APP_URL=http://localhost:5173
JWT_SECRET=replace-with-a-random-secret-of-at-least-32-characters
DATABASE_URL=your-neon-pooled-connection-string
DIRECT_URL=your-neon-direct-connection-string
REDIS_URL=redis://localhost:6379
UPLOAD_DIR=./uploads
```

Generate a JWT secret with:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

The project uses Prisma 6.19.3. Keep database credentials in the backend `.env`, never in React `VITE_` variables. `.env`, `.data/` and `uploads/` are excluded from Git.

### 2. Prepare the database

```sh
npm run db:generate
npm run db:migrate
npm run db:check
```

These commands generate Prisma Client, apply committed migrations and check connectivity. Neon may take a little longer to respond after being idle.

### 3. Optional sample accounts

For a new, empty development database, seed fictional accounts and courses **before registering users**:

```sh
npm run db:seed
```

Sign in using your own account. Example format only; replace both values:

```text
Email: your-email@example.com
Password: your-account-password
```

The seed skips a database that already contains users. Existing Neon installations should use their existing accounts; seeding will not reset passwords or add sample accounts to a populated database.

Students and instructors can sign up in the app. New instructors can sign in immediately, but an admin must open **People & roles** and select **Approve teaching** before they can create courses, upload videos or schedule classes. Admin signup is disabled. The seeded instructor already has teaching access.

To add the free **Build your first web page** sample course after an approved instructor exists:

```sh
npm run db:sample
```

This preserves existing accounts and progress and skips an existing copy of the course.

### 4. Start Redis and video processing

Start Docker Desktop, then run:

```sh
npm run media:up
```

This starts Redis on port 6379 and an FFmpeg worker connected to the database from `.env`. The worker and local API share `uploads/`; no native Windows FFmpeg installation is needed.

Approved instructors upload MP4, MOV or WebM files, up to 500 MB, from the Studio. Keep the worker running until processing reaches **READY**. Enrolled learners can then play the protected HLS video.

```sh
npm run media:logs
npm run media:down
```

`media:down` stops media services while retaining stored data. Run `media:up` again to restart them or apply worker environment changes.

### 5. Start the website

```sh
npm run dev
```

- Website: **http://localhost:5173**
- API: **http://localhost:4000**
- Health check: **http://localhost:4000/api/health**

The development command starts Express and Vite. Keep the API on port 4000 because the Vite proxy targets that port. A configured Neon installation should report `mode: "postgresql"` in the health response.

On subsequent starts, run Docker Desktop, `npm run media:up` and `npm run dev`. Do not repeat migrations or seeding unless needed. Restart the API after changing `.env`.

## Razorpay Test payments

Set your Razorpay **Test** credentials in `.env` and restart the API:

```dotenv
RAZORPAY_KEY_ID=rzp_test_your_key_id
RAZORPAY_KEY_SECRET=your_test_key_secret
RAZORPAY_WEBHOOK_SECRET=your_test_webhook_secret
```

Only Test keys are accepted. Course prices use INR paise: `49900` means INR 499. After a captured payment is verified, the app grants enrollment and records revenue. The dashboard shows sales, a 10% platform fee and the estimated instructor share; it does not send payouts.

For webhook recovery, configure `payment.captured` and `order.paid` in Razorpay Test mode with this backend endpoint:

```text
https://your-backend.example/api/payments/razorpay/webhook
```

Use the matching webhook secret in `.env`. Provider webhooks need a publicly reachable HTTPS backend or development tunnel; they cannot call localhost directly. The checkout callback and authenticated payment-status check also verify captured payments.

## Live classes and certificates

An approved instructor schedules a class for a course. Enrolled students join from **Live classes**. WebRTC handles media and Socket.IO handles signaling and persisted chat, with a limit of eight participants per room.

Camera, microphone and screen sharing require localhost or HTTPS and browser permission. Test with two enrolled browser profiles. Configure TURN entries in `ICE_SERVERS_JSON` for restrictive networks; the example environment contains a STUN entry.

Students earn a PDF certificate after completing all lessons and passing the course quizzes. Certificates are available from the course and **Certificates** workspace.

## Optional S3 and CloudFront configuration

Leave `CLOUDFRONT_URL` empty for authenticated local HLS. For private AWS delivery, configure the AWS identity and region, then prepare signing keys and preview the stack:

```sh
npm run cdn:prepare
npm run cdn:deploy
```

The template is `infra/aws/media-stack.json`. Prepared parameters and signing files are written under `.data/cloudfront/`. `npm run cdn:deploy -- --apply` creates AWS resources. After successful deployment, copy settings from `.data/cloudfront/cloudfront.env` into `.env`, configure the worker's S3 access and restart the API and worker.

Preview existing READY video uploads with `npm run cdn:sync`; add `-- --apply` to upload them. Verify delivery with `npm run cdn:verify -- --lesson LESSON_ID`, replacing `LESSON_ID` with a READY lesson ID. Keep signing keys private. The default CloudFront HTTPS hostname works without a custom domain.

## Quick UI demo without PostgreSQL

For a separate lightweight demo, set `DEMO_MODE=true` and run `npm run dev`. Choose **Try a demo account**. This mode stores data in `.data/demo.json` and simulates payments. Use the Neon setup for actual video uploads and payment integration testing. Switching modes does not transfer records between JSON and PostgreSQL.

## Build and verification

```sh
npm test
npm run build
```

To serve the compiled React app and API together at **http://localhost:4000**, set `APP_URL=http://localhost:4000`, then run `npm start`. Keep the separate video services running for uploads. A public deployment needs the HTTPS application origin, `NODE_ENV=production`, private secrets and persistent upload storage.

| Command                   | Purpose                                                           |
| ------------------------- | ----------------------------------------------------------------- |
| `npm run db:check`        | Read-only database connectivity and schema check                  |
| `npm run db:dev`          | Create and apply a development schema migration                   |
| `npm run db:verify`       | Exercise the learning flow on the configured development database |
| `npm run media:verify`    | Exercise real upload, queue, conversion and protected playback    |
| `npm run payments:verify` | Exercise database payment flows using a fake provider             |
| `npm run format`          | Format project source and README                                  |

Integration verification commands create temporary fixtures and normally remove their own records. Use a development database. `payments:verify` does not perform a hosted Razorpay checkout.
