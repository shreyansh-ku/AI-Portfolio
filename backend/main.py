from uuid import uuid4
from pydantic import BaseModel, Field
from fastapi.middleware.cors import CORSMiddleware
from fastapi import FastAPI, UploadFile, File, HTTPException 
from fastapi.middleware.cors import CORSMiddleware #BACKEND CORS
from fastapi.responses import StreamingResponse
import json

#DATABASE CONNECTION 
from database import (
    create_tables,
    SessionLocal,
    Candidate,
    ChatMessage as DBChatMessage,
)

from chat_ai import stream_chat_with_resume
from parser import extract_text
from pydantic import BaseModel
from resume_ai import parse_resume
from chat_ai import chat_with_resume
from schemas import ResumeProfile
current_profile = None #Global Variable ->Ye uploaded candidate ka latest profile store karega.

current_candidate_id = None

app = FastAPI(title="AI Portfolio API") #just like const app=express() for object creation
create_tables()

#Cors ke leye 

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "https://ai-portfolio-chi-rust.vercel.app",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def load_latest_candidate():
    global current_profile, current_candidate_id

    with SessionLocal() as db:
        candidate = (
            db.query(Candidate)
            .order_by(Candidate.id.desc())
            .first()
        )

        if candidate:
            current_profile = candidate.profile
            current_candidate_id = candidate.id
            print("Loaded candidate:", candidate.id)
        else:
            print("No saved candidate found.")


create_tables()
load_latest_candidate()
@app.get("/")
def home():
    return {
        "message": "AI Portfolio Backend is running"
    }
#test_profile = {
  #  "name": "Rahul",
  #  "skills": ["Python", "FastAPI", "SQL"],
   # "projects": ["AI Resume Parser"],
    #"education": ["B.Tech in Computer Science"]


@app.post("/upload/resume")
async def upload_resume(file: UploadFile = File(...)):
    global current_profile, current_candidate_id

    if not file.filename:
        raise HTTPException(
            status_code=400,
            detail="Filename is missing.",
        )

    if not file.filename.lower().endswith((".pdf", ".docx")):
        raise HTTPException(
            status_code=400,
            detail="Please upload a PDF or DOCX file.",
        )

    try:
        file_bytes = await file.read()

        if not file_bytes:
            raise HTTPException(
                status_code=400,
                detail="Uploaded file is empty.",
            )

        text = extract_text(file.filename, file_bytes)
        profile = parse_resume(text)

        # Convert the Pydantic object into a dictionary.
        profile_data = profile.model_dump()

        # Save the candidate profile in SQLite.
        with SessionLocal() as db:
            candidate = Candidate(
                filename=file.filename,
                profile=profile_data,
            )

            db.add(candidate)
            db.commit()
            db.refresh(candidate)

            # Keep the saved candidate available to the current app.
            current_candidate_id = candidate.id

        current_profile = profile_data

        return {
            "filename": file.filename,
            "characters": len(text),
            "profile": profile_data,
        }

    except HTTPException:
        raise

    except ValueError as error:
        raise HTTPException(
            status_code=422,
            detail=str(error),
        ) from error

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail="Failed to process or save the resume.",
        ) from error

    finally:
        await file.close()



#---------------CHATBOT---------------

class ChatMessage(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    question: str
    conversation_id: str
    history: list[ChatMessage] = Field(default_factory=list)



@app.post("/chat/stream")
def chat_stream(data: ChatRequest):
    if current_profile is None:
        raise HTTPException(
            status_code=400,
            detail="Please upload a resume first.",
        )

    if current_candidate_id is None:
        raise HTTPException(
            status_code=400,
            detail="No saved candidate found. Please upload the resume again.",
        )

    history = [
        message.model_dump()
        for message in data.history
    ]

    def generate():
        full_answer = ""

        try:
            # Save the user's question.
            with SessionLocal() as db:
                user_message = DBChatMessage(
                    candidate_id=current_candidate_id,
                    conversation_id=data.conversation_id,
                    role="user",
                    content=data.question,
                )
                db.add(user_message)
                db.commit()

            # Stream the AI response.
            for chunk in stream_chat_with_resume(
                profile=current_profile,
                question=data.question,
                history=history,
            ):
                full_answer += chunk
                yield json.dumps({"text": chunk}) + "\n"

            # Save the completed AI response.
            with SessionLocal() as db:
                assistant_message = DBChatMessage(
                    candidate_id=current_candidate_id,
                    conversation_id=data.conversation_id,
                    role="assistant",
                    content=full_answer,
                )
                db.add(assistant_message)
                db.commit()

            yield json.dumps({"done": True}) + "\n"

        except Exception:
            yield json.dumps({
                "error": "AI streaming failed. Please try again."
            }) + "\n"

    return StreamingResponse(
        generate(),
        media_type="application/x-ndjson",
    )

#----SAved chat history ko database se retrieve karege---

@app.get("/chat/history/{conversation_id}")
def get_chat_history(conversation_id: str):
    if current_candidate_id is None:
        raise HTTPException(
            status_code=400,
            detail="Please upload a resume first."
        )

    with SessionLocal() as db:
        messages = (
            db.query(DBChatMessage)
            .filter(
                DBChatMessage.candidate_id == current_candidate_id,
                DBChatMessage.conversation_id == conversation_id,
            )
            .order_by(DBChatMessage.id.asc())
            .all()
        )

        return {
            "conversation_id": conversation_id,
            "messages": [
                {
                    "role": message.role,
                    "content": message.content,
                    "created_at": message.created_at.isoformat(),
                }
                for message in messages
            ],
        }
