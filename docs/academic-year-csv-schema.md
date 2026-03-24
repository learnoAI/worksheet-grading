# Academic Year CSV Upload Schemas

These CSV formats are used to onboard classes, teachers, and students for a new academic year.

## CSV 1: Class-Teacher Mapping

Maps classes to their assigned teachers for the new academic year.

| Column | Required | Description | Example |
|--------|----------|-------------|---------|
| `className` | Yes | Name of the class | Class 5A |
| `academicYear` | Yes | Academic year identifier | 26-27 |
| `teacherName` | Yes | Full name of the teacher | Ramesh Kumar |
| `teacherUsername` | Yes | Teacher's login username (unique identifier) | ramesh.kumar |

### Sample

```csv
className,academicYear,teacherName,teacherUsername
Class 5A,26-27,Ramesh Kumar,ramesh.kumar
Class 5B,26-27,Priya Sharma,priya.sharma
Class 6A,26-27,Ramesh Kumar,ramesh.kumar
Class 6B,26-27,Anita Verma,anita.verma
```

### Notes

- One teacher can be mapped to multiple classes (one row per class-teacher pair).
- If a class has multiple teachers, add one row per teacher.
- `teacherUsername` must match an existing teacher's username in the system.
- Classes that do not already exist will be created automatically.
- School is determined from the upload context (selected by the admin).

## CSV 2: Student-Class Mapping

Maps students to their assigned classes for the new academic year.

| Column | Required | Description | Example |
|--------|----------|-------------|---------|
| `tokenNumber` | Yes | Student's token/ID number (unique identifier) | TN001 |
| `studentName` | Yes | Full name of the student | Aarav Sharma |
| `className` | Yes | Class assigned to the student | Class 5A |
| `academicYear` | Yes | Academic year identifier | 26-27 |

### Sample

```csv
tokenNumber,studentName,className,academicYear
TN001,Aarav Sharma,Class 5A,26-27
TN002,Neha Patel,Class 5A,26-27
TN003,Rohan Gupta,Class 5B,26-27
TN004,Sita Devi,Class 6A,26-27
TN005,Vikram Singh,Class 6B,26-27
```

### Notes

- `tokenNumber` must match an existing student's token number in the system, or a new student will be created.
- New students are created with a default password (`saarthi@123`).
- A student can appear in multiple rows if they belong to multiple classes.
- School is determined from the upload context (selected by the admin).
