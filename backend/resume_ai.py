import json
import os

from dotenv import load_dotenv
from groq import Groq

from schemas import ResumeProfile

load_dotenv()


def parse_resume(resume_text: str) -> ResumeProfile:
    api_key = os.getenv("GROQ_API_KEY")

    if not api_key:
        raise ValueError("GROQ_API_KEY missing in .env")

    client = Groq(api_key=api_key)

    system_prompt = """
    You are an expert resume parser.

    Extract candidate details from the provided resume.
    Return only valid JSON.

    Rules:
    - Never invent information.
    - Use null for missing single values.
    - Use empty lists for missing list values.
    - Include internships under experiences.
    """

    response = client.chat.completions.create(
        model="openai/gpt-oss-20b",
        messages=[
            {"role": "system", 
             "content": system_prompt
            },
            {
                "role": "user",
                "content": (
                    "Extract the resume details matching this schema:\n"
                    f"{json.dumps(ResumeProfile.model_json_schema())}\n\n"
                    f"Resume:\n{resume_text}"
                ),
            },
        ],
        response_format={"type": "json_object"},
    )

    raw_output = response.choices[0].message.content

    if not raw_output:
        raise ValueError("AI returned an empty response")

    data = json.loads(raw_output)

    return ResumeProfile.model_validate(data)
