
from datetime import datetime, timezone
from sqlalchemy import inspect, text
from sqlalchemy import (
    create_engine,
    ForeignKey,
    String,
    Text,
    DateTime,
    JSON,
)
from sqlalchemy.orm import (
    DeclarativeBase,
    Mapped,
    mapped_column,
    sessionmaker,
)

# SQLite database file will be created in the backend folder.
DATABASE_URL = "sqlite:///./ai_portfolio.db"

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
)

SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False,
)


class Base(DeclarativeBase):
    pass


class Candidate(Base):
    __tablename__ = "candidates"

    id: Mapped[int] = mapped_column(primary_key=True)
    filename: Mapped[str] = mapped_column(String(255))
    profile: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
    )


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    candidate_id: Mapped[int] = mapped_column(
        ForeignKey("candidates.id"),
        index=True,
    )
    conversation_id: Mapped[str] = mapped_column(
    String(36),
    index=True,
    default="default",
)
    role: Mapped[str] = mapped_column(String(20))
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
    )


def create_tables():
    Base.metadata.create_all(bind=engine)

    with engine.begin() as connection:
        columns = {
            column["name"]
            for column in inspect(connection).get_columns(
                "chat_messages"
            )
        }

        if "conversation_id" not in columns:
            connection.execute(
                text(
                    "ALTER TABLE chat_messages "
                    "ADD COLUMN conversation_id "
                    "VARCHAR(36) NOT NULL DEFAULT 'default'"
                )
            )