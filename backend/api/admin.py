from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.utils.translation import gettext_lazy as _

from .models import (
    User, UserProfile,
    SavedRecipe, RecipeIngredient, RecipeStep,
    MealPlan, MealPlanDay, MealPlanMeal,
)


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    ordering = ['email']
    list_display = ['email', 'is_staff', 'is_active']
    fieldsets = (
        (None, {'fields': ('email', 'password')}),
        (_('Permissions'), {'fields': ('is_staff', 'is_active', 'is_superuser', 'groups', 'user_permissions')}),
    )
    add_fieldsets = (
        (None, {
            'classes': ('wide',),
            'fields': ('email', 'password1', 'password2', 'is_staff', 'is_active'),
        }),
    )
    search_fields = ['email']


@admin.register(UserProfile)
class UserProfileAdmin(admin.ModelAdmin):
    list_display = ['user', 'calorie_goal', 'dietary_restrictions']
    search_fields = ['user__email', 'dietary_restrictions']


@admin.register(SavedRecipe)
class SavedRecipeAdmin(admin.ModelAdmin):
    list_display = ['title', 'user', 'calories', 'created_at']
    search_fields = ['title', 'user__email']
    list_filter = ['created_at']
    readonly_fields = ['created_at']


@admin.register(RecipeIngredient)
class RecipeIngredientAdmin(admin.ModelAdmin):
    list_display = ['recipe', 'order', 'text']
    search_fields = ['recipe__title', 'text']


@admin.register(RecipeStep)
class RecipeStepAdmin(admin.ModelAdmin):
    list_display = ['recipe', 'order']
    search_fields = ['recipe__title', 'text']


@admin.register(MealPlan)
class MealPlanAdmin(admin.ModelAdmin):
    list_display = ['user', 'duration_days']
    search_fields = ['user__email']


@admin.register(MealPlanDay)
class MealPlanDayAdmin(admin.ModelAdmin):
    list_display = ['meal_plan', 'day_number']
    search_fields = ['meal_plan__user__email']


@admin.register(MealPlanMeal)
class MealPlanMealAdmin(admin.ModelAdmin):
    list_display = ['day', 'meal_type', 'recipe', 'recipe_title']
    search_fields = ['day__meal_plan__user__email', 'recipe_title', 'recipe__title']
