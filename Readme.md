# Worksheet Grading App

A full-stack application for grading offline worksheets. Teachers can upload images of student worksheets, which are then processed asynchronously via a background queue.

## Features

- Image capture and upload (via mobile camera or file upload)
- Association of uploaded worksheets with students and classes
- Asynchronous processing via a background queue
- In-app notifications for teachers when processing is complete
- User management (admin/superadmin only)
- Hierarchical organization (classes, schools, clusters)

## Tech Stack

### Backend
- Express.js with TypeScript
- PostgreSQL with Prisma ORM
- AWS S3 for image storage
- Bull for background job processing
- JWT for authentication

### Frontend
- Next.js with React
- TypeScript
- ShadCN UI components
- Tailwind CSS

## Docs

- Curriculum mapping system:
  - `backend/docs/curriculum-mapping-system.md`

## Getting Started

### Prerequisites

- Node.js (v18+)
- PostgreSQL database
- Redis (for Bull queue)
- AWS S3 bucket (or local alternative)

### Installation

1. Clone the repository:
   ```
   git clone https://github.com/yourusername/worksheet-grading.git
   cd worksheet-grading
   ```

2. Install backend dependencies:
   ```
   cd backend
   npm install
   ```

3. Install frontend dependencies:
   ```
   cd ../web-app
   npm install
   ```

4. Set up environment variables:
   - Copy `.env.example` to `.env` in both the backend and frontend directories
   - Update the values with your configuration

5. Set up the database:
   ```
   cd backend
   npm run prisma:migrate
   npm run prisma:seed
   ```

### Running the Application

1. Start the backend server:
   ```
   cd backend
   npm run dev
   ```

2. Start the frontend development server:
   ```
   cd ../web-app
   npm run dev
   ```

3. Access the application at `http://localhost:3000`

## Default Users

After running the seed script, the following users will be available:

- Superadmin: `superadmin` / `password123`
- Admin: `admin` / `password123`
- Teacher: `teacher1` / `password123`
- Student: `student1` / `password123`

## License

This project is licensed under the MIT License - see the LICENSE file for details. 
