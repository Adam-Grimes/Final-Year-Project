from django.urls import path
from .views import ScanIngredientsView

urlpatterns = [
    path('scan-ingredients/', ScanIngredientsView.as_view(), name='scan-ingredients'),
] 