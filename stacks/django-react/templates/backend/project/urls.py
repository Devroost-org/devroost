from django.http import JsonResponse
from django.urls import path


def health(_request):
    return JsonResponse({"framework": "django", "frontend": "react", "status": "ok"})


def todos(_request):
    return JsonResponse(
        {
            "items": [
                {"id": 1, "title": "Django API", "completed": True},
                {"id": 2, "title": "React frontend", "completed": True},
                {"id": 3, "title": "Devroost local workflow", "completed": False},
            ]
        }
    )


urlpatterns = [
    path("", health),
    path("health", health),
    path("api/health", health),
    path("api/todos", todos),
]