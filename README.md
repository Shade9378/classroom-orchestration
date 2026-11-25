## A Centralized System for Classroom Planning, Orchestration, and Resource Management for Physical Computing Courses
A centralized classroom management system built on top of NetsBlox to support activity planning, real-time classroom orchestration, physical resource management, and infrastructure failure recovery in IoT and robotics education.

## System Interface

![Classroom management and monitoring interface](assets/readme/classroom-management-monitoring.png)

![Activities and playlist planning](assets/readme/activities-playlist-planning.png)

![Activities and resource assignment interface](assets/readme/activities-resource-assignment.png)

## Student Program Interface

![Student program interface](assets/readme/student-program.png)

## Setup

### System

Install Git, Node.js 24, and Docker with Docker Compose. Start Docker, then run in Bash (Windows: WSL):

```bash
git clone https://github.com/Shade9378/classroom-orchestration.git
cd classroom-orchestration
npm ci
cp .env.example .env
npm run db:start
npm run db:generate
npm run db:migrate
npm run dev
```

Open http://localhost:5173, create a teacher account, and create a session. Keep the terminal running. For later runs:

```bash
npm run db:start
npm run dev
```

### Student Program

With the system running, open [http://localhost:5173/student](http://localhost:5173/student), internet access is required.
