
import os

from dotenv import load_dotenv
from groq import Groq

load_dotenv()


# Shared instructions for both normal and streaming chat.
SYSTEM_PROMPT = (
    "You are an AI assistant representing a job candidate. "

    "Answer using only the candidate profile provided. "
    "Never invent skills, experience, qualifications, "
    "projects, or achievements. "

    "If information is missing, clearly say it is not mentioned "
    "in the profile. Use previous conversation messages to "
    "understand follow-up questions, but treat the candidate "
    "profile as the source of truth. "

    "Clearly distinguish facts stated in the profile from "
    "reasonable inferences. Label inferences explicitly. "
    "Do not infer specific technologies, responsibilities, "
    "or achievements from a project title alone. "

    "When asked why you made a recommendation, explain "
    "the evidence and mention any limitations. "

    "FORMAT EVERY ANSWER IN CLEAN MARKDOWN. "
    "Use numbered lists for multiple projects or items. "
    "Put project names and important terms in **bold**. "
    "Use short paragraphs and blank lines between sections. "
    "Use headings only when they improve readability. "
    "Use bullet points when appropriate. "
    "Keep answers clear, readable, and concise. "
    "Do not return HTML or JSON unless explicitly requested. "
    
"""Format your responses using clean Markdown.
Rules:
- Prefer numbered lists and bullet points over tables.
- Use **bold** for project names, skills, and important terms.
- Keep paragraphs short and readable.
- Do not use HTML tags such as `<br>` in responses.
- Use tables only when the user explicitly requests a comparison table.
- Answer questions using information explicitly available in the candidate's resume.
- Never invent project responsibilities, technologies, achievements, or experience.
- If a detail is missing from the resume, clearly say that it is not specified.
- Clearly label any inference as an inference, and only provide one when the user asks for it.
- Keep answers concise, relevant, and professional."""
    
)


def build_messages(
    profile: dict,
    question: str,
    history: list[dict] | None = None,
) -> list[dict]:
    """Build the conversation messages for the AI."""

    messages = [
        {
            "role": "system",
            "content": SYSTEM_PROMPT,
        },
        {
            "role": "user",
            "content": f"Candidate profile:\n{profile}",
        },
    ]

    # Include the last 10 conversation messages.
    for message in (history or [])[-10:]:
        if message.get("role") in ("user", "assistant"):
            content = message.get("content", "")

            if isinstance(content, str) and content.strip():
                messages.append({
                    "role": message["role"],
                    "content": content,
                })

    # Add the latest question after conversation history.
    messages.append({
        "role": "user",
        "content": question,
    })

    return messages


def get_client() -> Groq:
    """Create the Groq client using the API key."""

    api_key = os.getenv("GROQ_API_KEY")

    if not api_key:
        raise ValueError("GROQ_API_KEY missing in .env")

    return Groq(api_key=api_key)


def chat_with_resume(
    profile: dict,
    question: str,
    history: list[dict] | None = None,
) -> str:
    """Generate a complete answer about the candidate's resume."""

    client = get_client()

    messages = build_messages(
        profile=profile,
        question=question,
        history=history,
    )

    response = client.chat.completions.create(
        model="openai/gpt-oss-20b",
        messages=messages,
    )

    answer = response.choices[0].message.content

    return answer or "Sorry, I couldn't generate an answer."


def stream_chat_with_resume(
    profile: dict,
    question: str,
    history: list[dict] | None = None,
):
    """Generate an answer in streaming chunks."""

    client = get_client()

    messages = build_messages(
        profile=profile,
        question=question,
        history=history,
    )

    stream = client.chat.completions.create(
        model="openai/gpt-oss-20b",
        messages=messages,
        stream=True,
    )

    for chunk in stream:
        if not chunk.choices:
            continue

        content = chunk.choices[0].delta.content

        if content:
            yield content
