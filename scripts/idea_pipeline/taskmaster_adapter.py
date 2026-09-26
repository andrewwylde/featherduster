"""TaskMaster Storage Adapter for Featherduster.

Provides a typed, resilient interface to TaskMaster JSON storage (.taskmaster/tasks/tasks.json).
Supports multi-tag task separation, atomic writes, query filtering, and task lifecycle management.
"""

from __future__ import annotations

import json
import os
import shutil
import tempfile
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


@dataclass
class TaskSubtask:
    id: str
    title: str
    description: str = ""
    status: str = "pending"  # "pending", "in-progress", "done"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> TaskSubtask:
        return cls(
            id=str(data.get("id", "")),
            title=data.get("title", ""),
            description=data.get("description", ""),
            status=data.get("status", "pending"),
        )


@dataclass
class TaskMasterTask:
    id: int
    title: str
    description: str
    details: str = ""
    testStrategy: str = ""
    status: str = "pending"  # "pending", "in-progress", "done", "blocked", "deferred", "cancelled"
    dependencies: list[str | int] = field(default_factory=list)
    priority: str = "medium"  # "high", "medium", "low"
    subtasks: list[dict[str, Any]] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)
    updatedAt: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        if not d.get("tags"):
            d.pop("tags", None)
        return d

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> TaskMasterTask:
        raw_id = data.get("id", 1)
        try:
            task_id = int(raw_id)
        except (ValueError, TypeError):
            task_id = 1
        return cls(
            id=task_id,
            title=data.get("title", ""),
            description=data.get("description", ""),
            details=data.get("details", ""),
            testStrategy=data.get("testStrategy", ""),
            status=data.get("status", "pending"),
            dependencies=[str(dep) for dep in data.get("dependencies", [])],
            priority=data.get("priority", "medium"),
            subtasks=list(data.get("subtasks", [])),
            tags=list(data.get("tags", [])),
            updatedAt=data.get("updatedAt", datetime.now(timezone.utc).isoformat()),
        )


class TaskMasterAdapter:
    """Interface to .taskmaster storage for Featherduster idea pipeline and agent loops."""

    def __init__(self, project_root: str | Path | None = None) -> None:
        self.project_root = Path(project_root or Path.cwd()).resolve()
        self.taskmaster_dir = self.project_root / ".taskmaster"
        self.tasks_file = self.taskmaster_dir / "tasks" / "tasks.json"

    def ensure_initialized(self, default_tags: list[str] | None = None) -> None:
        """Ensure .taskmaster directories and tasks.json exist."""
        self.taskmaster_dir.mkdir(parents=True, exist_ok=True)
        (self.taskmaster_dir / "tasks").mkdir(parents=True, exist_ok=True)
        (self.taskmaster_dir / "docs").mkdir(parents=True, exist_ok=True)
        (self.taskmaster_dir / "reports").mkdir(parents=True, exist_ok=True)

        tags = default_tags or ["master", "proposals"]
        if not self.tasks_file.exists():
            now_iso = datetime.now(timezone.utc).isoformat()
            init_data = {
                tag: {
                    "tasks": [],
                    "metadata": {
                        "created": now_iso,
                        "updated": now_iso,
                        "description": f"Tasks for {tag} context",
                    },
                }
                for tag in tags
            }
            self._write_raw(init_data)
        else:
            data = self._read_raw()
            modified = False
            for tag in tags:
                if tag not in data:
                    now_iso = datetime.now(timezone.utc).isoformat()
                    data[tag] = {
                        "tasks": [],
                        "metadata": {
                            "created": now_iso,
                            "updated": now_iso,
                            "description": f"Tasks for {tag} context",
                        },
                    }
                    modified = True
            if modified:
                self._write_raw(data)

    def _read_raw(self) -> dict[str, Any]:
        """Read tasks.json with fallback."""
        if not self.tasks_file.exists():
            return {}
        try:
            with open(self.tasks_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}

    def _write_raw(self, data: dict[str, Any]) -> None:
        """Atomically write data to tasks.json."""
        self.tasks_file.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile("w", dir=str(self.tasks_file.parent), delete=False, encoding="utf-8") as tf:
            json.dump(data, tf, indent=2, ensure_ascii=False)
            temp_path = Path(tf.name)
        shutil.move(str(temp_path), str(self.tasks_file))

    def get_tags(self) -> list[str]:
        """Return all available tag contexts."""
        data = self._read_raw()
        return [k for k in data.keys() if isinstance(data[k], dict) and "tasks" in data[k]]

    def get_tasks(self, tag: str = "proposals", status: str | None = None) -> list[TaskMasterTask]:
        """Retrieve tasks under a given tag, optionally filtered by status."""
        data = self._read_raw()
        tag_data = data.get(tag, {})
        raw_tasks = tag_data.get("tasks", []) if isinstance(tag_data, dict) else []
        tasks = [TaskMasterTask.from_dict(t) for t in raw_tasks if isinstance(t, dict)]
        if status:
            tasks = [t for t in tasks if t.status == status]
        return tasks

    def get_task(self, task_id: int | str, tag: str = "proposals") -> TaskMasterTask | None:
        """Get a single task by ID."""
        try:
            task_id_int = int(task_id)
        except (ValueError, TypeError):
            return None
        for t in self.get_tasks(tag=tag):
            if t.id == task_id_int:
                return t
        return None

    def add_task(
        self,
        title: str,
        description: str,
        details: str = "",
        test_strategy: str = "",
        priority: str = "medium",
        dependencies: list[str | int] | None = None,
        tag: str = "proposals",
        tags: list[str] | None = None,
    ) -> TaskMasterTask:
        """Add a new task under the specified tag context."""
        self.ensure_initialized([tag])
        data = self._read_raw()
        tag_data = data.setdefault(tag, {"tasks": [], "metadata": {}})
        raw_tasks = tag_data.setdefault("tasks", [])

        existing_ids = [t.get("id", 0) for t in raw_tasks if isinstance(t, dict)]
        next_id = max(existing_ids, default=0) + 1

        new_task = TaskMasterTask(
            id=next_id,
            title=title.strip(),
            description=description.strip(),
            details=details.strip(),
            testStrategy=test_strategy.strip(),
            status="pending",
            dependencies=dependencies or [],
            priority=priority,
            tags=tags or [],
            updatedAt=datetime.now(timezone.utc).isoformat(),
        )

        raw_tasks.append(new_task.to_dict())
        tag_data["metadata"]["updated"] = datetime.now(timezone.utc).isoformat()
        self._write_raw(data)
        return new_task

    def update_task(self, task: TaskMasterTask, tag: str = "proposals") -> bool:
        """Update an existing task in place."""
        data = self._read_raw()
        tag_data = data.get(tag)
        if not tag_data or "tasks" not in tag_data:
            return False

        task.updatedAt = datetime.now(timezone.utc).isoformat()
        updated = False
        for idx, t in enumerate(tag_data["tasks"]):
            if isinstance(t, dict) and t.get("id") == task.id:
                tag_data["tasks"][idx] = task.to_dict()
                updated = True
                break

        if updated:
            tag_data["metadata"]["updated"] = task.updatedAt
            self._write_raw(data)
        return updated

    def set_status(self, task_id: int | str, status: str, tag: str = "proposals") -> bool:
        """Update status of a specific task."""
        task = self.get_task(task_id, tag=tag)
        if not task:
            return False
        task.status = status
        return self.update_task(task, tag=tag)

    def remove_task(self, task_id: int | str, tag: str = "proposals") -> bool:
        """Remove a task from the specified tag context."""
        data = self._read_raw()
        tag_data = data.get(tag)
        if not tag_data or "tasks" not in tag_data:
            return False

        try:
            task_id_int = int(task_id)
        except (ValueError, TypeError):
            return False

        original_len = len(tag_data["tasks"])
        tag_data["tasks"] = [t for t in tag_data["tasks"] if isinstance(t, dict) and t.get("id") != task_id_int]

        if len(tag_data["tasks"]) < original_len:
            tag_data["metadata"]["updated"] = datetime.now(timezone.utc).isoformat()
            self._write_raw(data)
            return True
        return False

    def promote_task(
        self,
        task_id: int | str,
        from_tag: str = "proposals",
        to_tag: str = "master",
    ) -> TaskMasterTask | None:
        """Promote a proposal to the active work queue (master tag)."""
        source_task = self.get_task(task_id, tag=from_tag)
        if not source_task:
            return None

        # Add to destination tag
        dest_task = self.add_task(
            title=source_task.title,
            description=source_task.description,
            details=source_task.details,
            test_strategy=source_task.testStrategy,
            priority=source_task.priority,
            tag=to_tag,
            tags=source_task.tags + [f"promoted-from-{from_tag}"],
        )

        # Preserve subtasks if any
        if source_task.subtasks:
            dest_task.subtasks = source_task.subtasks
            self.update_task(dest_task, tag=to_tag)

        # Mark source task as done / promoted
        source_task.status = "done"
        source_task.details += f"\n[Promoted to #{dest_task.id} in '{to_tag}']"
        self.update_task(source_task, tag=from_tag)

        return dest_task
