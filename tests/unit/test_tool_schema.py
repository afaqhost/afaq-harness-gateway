import pytest
from pydantic import ValidationError
from app.api.openai import ChatRequest, ToolDef

pytestmark = pytest.mark.unit


def test_tool_def_validates_function_name():
    # missing name should raise 422
    with pytest.raises(ValidationError):
        ToolDef(type="function", function={"description": "no name"})

    # valid
    td = ToolDef(type="function", function={"name": "get_weather", "description": "get weather", "parameters": {"type": "object"}})
    assert td.function.name == "get_weather"


def test_chat_request_validates_tool_choice():
    # invalid tool_choice string
    with pytest.raises(ValidationError):
        ChatRequest(model="opencode//opencode/big-pickle", messages=[{"role": "user", "content": "hi"}], tool_choice="invalid")

    # valid auto
    req = ChatRequest(model="opencode//opencode/big-pickle", messages=[{"role": "user", "content": "hi"}], tool_choice="auto")
    assert req.tool_choice == "auto"

    # valid dict
    req2 = ChatRequest(model="opencode//opencode/big-pickle", messages=[{"role": "user", "content": "hi"}], tool_choice={"type": "function", "function": {"name": "get_weather"}})
    assert req2.tool_choice["function"]["name"] == "get_weather"

    # invalid dict
    with pytest.raises(ValidationError):
        ChatRequest(model="opencode//opencode/big-pickle", messages=[{"role": "user", "content": "hi"}], tool_choice={"type": "function", "function": {}})


def test_response_format_validates():
    # invalid type
    with pytest.raises(ValidationError):
        ChatRequest(model="opencode//opencode/big-pickle", messages=[{"role": "user", "content": "hi"}], response_format={"type": "invalid"})

    # valid json_object
    req = ChatRequest(model="opencode//opencode/big-pickle", messages=[{"role": "user", "content": "hi"}], response_format={"type": "json_object"})
    assert req.response_format.type == "json_object"

    # valid json_schema
    req2 = ChatRequest(model="opencode//opencode/big-pickle", messages=[{"role": "user", "content": "hi"}], response_format={"type": "json_schema", "json_schema": {"type": "object", "properties": {"name": {"type": "string"}}}})
    assert req2.response_format.type == "json_schema"


def test_chat_request_with_tools():
    req = ChatRequest(
        model="opencode//opencode/big-pickle",
        messages=[{"role": "user", "content": "hi"}],
        tools=[{"type": "function", "function": {"name": "get_weather", "parameters": {"type": "object", "properties": {"city": {"type": "string"}}}}}],
    )
    assert len(req.tools) == 1
    assert req.tools[0].function.name == "get_weather"
