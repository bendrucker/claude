def greet(name: str) -> str:
    return "Hello, " + name  # type: ignore

result = greet(123)
