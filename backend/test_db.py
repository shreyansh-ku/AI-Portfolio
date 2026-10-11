
from database import create_tables, SessionLocal, Candidate

create_tables()

with SessionLocal() as db:
    print("Database connected successfully!")

    candidate = Candidate(
        filename="test_resume.pdf",
        profile={"name": "Test Candidate", "skills": ["Python"]},
    )

    db.add(candidate)
    db.commit()
    db.refresh(candidate)

    print("Test candidate ID:", candidate.id)
