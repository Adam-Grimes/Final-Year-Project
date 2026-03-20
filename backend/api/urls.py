from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView
from .views import (
    DetectIngredientsView, GenerateRecipeView,
    RegisterView, LoginView,
    SavedRecipeListView, SavedRecipeDetailView,
    UserProfileView, ChangePasswordView,
    ForgotPasswordView, ResetPasswordView,
)

urlpatterns = [
    # AI endpoints
    path('detect-ingredients/', DetectIngredientsView.as_view(), name='detect-ingredients'),
    path('generate-recipe/', GenerateRecipeView.as_view(), name='generate-recipe'),

    # Auth endpoints
    path('auth/register/', RegisterView.as_view(), name='register'),
    path('auth/login/', LoginView.as_view(), name='login'),
    path('auth/token/refresh/', TokenRefreshView.as_view(), name='token-refresh'),

    # Profile & password management
    path('auth/profile/', UserProfileView.as_view(), name='user-profile'),
    path('auth/change-password/', ChangePasswordView.as_view(), name='change-password'),
    path('auth/forgot-password/', ForgotPasswordView.as_view(), name='forgot-password'),
    path('auth/reset-password/', ResetPasswordView.as_view(), name='reset-password'),

    # Saved recipes
    path('recipes/', SavedRecipeListView.as_view(), name='saved-recipes'),
    path('recipes/<int:pk>/', SavedRecipeDetailView.as_view(), name='saved-recipe-detail'),
]
