import pytest
from backend.schemas.contracts import ScheduleRequest


def test_schedule_validation_hour_minute():
    with pytest.raises(Exception):
        ScheduleRequest(name='x', hour=24, minute=0, action='list_dir')
    with pytest.raises(Exception):
        ScheduleRequest(name='x', hour=10, minute=60, action='list_dir')
