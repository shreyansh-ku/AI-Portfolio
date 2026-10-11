
from io import BytesIO

from pypdf import PdfReader
from docx import Document


def extract_text(filename: str, file_bytes: bytes) -> str:
    extension = filename.lower().rsplit(".", 1)[-1]

    if extension == "pdf":
        reader = PdfReader(BytesIO(file_bytes))

        text = "\n".join(
            page.extract_text() or ""
            for page in reader.pages
        )

    elif extension == "docx":
        document = Document(BytesIO(file_bytes))

        text = "\n".join(
            paragraph.text
            for paragraph in document.paragraphs
        )

    else:
        raise ValueError("Only PDF and DOCX files are supported.")

    text = text.strip()

    if not text:
        raise ValueError(
            "No readable text found in the document."
        )

    return text
