from django.db import models
from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.utils.translation import gettext_lazy as _


class UserManager(BaseUserManager):
    """Custom manager that uses email instead of username."""

    def create_user(self, email, password=None, **extra_fields):
        if not email:
            raise ValueError(_('Email address is required.'))
        email = self.normalize_email(email)
        user = self.model(email=email, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, email, password=None, **extra_fields):
        extra_fields.setdefault('is_staff', True)
        extra_fields.setdefault('is_superuser', True)
        return self.create_user(email, password, **extra_fields)


class User(AbstractBaseUser, PermissionsMixin):
    """
    Custom user model. Uses email as the unique login identifier
    instead of Django's default username field.
    """
    email = models.EmailField(_('email address'), unique=True)
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)

    objects = UserManager()

    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = []

    class Meta:
        verbose_name = _('user')
        verbose_name_plural = _('users')

    def __str__(self):
        return self.email


class UserProfile(models.Model):
    """
    Stores personalised preferences for a user, used in prompt construction.
    One-to-one relationship with User.
    """
    user = models.OneToOneField(
        User, on_delete=models.CASCADE, related_name='profile'
    )
    calorie_goal = models.IntegerField(
        default=2000, help_text='Daily calorie target (e.g. 2000).'
    )
    allergies = models.TextField(
        blank=True, default='',
        help_text='Comma-separated list of allergies (e.g. peanuts, shellfish).'
    )
    dietary_restrictions = models.CharField(
        max_length=100, blank=True, default='',
        help_text='Specific diet type (e.g. Vegan, Halal).'
    )
    cuisine_preferences = models.TextField(
        blank=True, default='',
        help_text='Comma-separated list of preferred cuisines (e.g. Italian, Mexican).'
    )

    class Meta:
        verbose_name = 'user profile'
        verbose_name_plural = 'user profiles'

    def __str__(self):
        return f"{self.user.email}'s profile"


class SavedRecipe(models.Model):
    """
    Stores a user's saved/favourite recipes.
    Many-to-one relationship with User.
    """
    user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name='saved_recipes'
    )
    title = models.CharField(max_length=255)
    ingredients = models.JSONField(
        help_text='Structured list of ingredients, e.g. [{"name": "flour", "amount": "200g"}].'
    )
    steps = models.JSONField(
        help_text='Ordered list of recipe steps, e.g. ["Preheat oven", "Mix ingredients"].'
    )
    calories = models.IntegerField(help_text='Estimated calorie count for the meal.')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = 'saved recipe'
        verbose_name_plural = 'saved recipes'
        ordering = ['-created_at']

    def __str__(self):
        return self.title


class MealPlan(models.Model):
    """
    Stores a multi-day meal plan for a user.
    Many-to-one relationship with User.
    """
    user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name='meal_plans'
    )
    duration_days = models.IntegerField(
        help_text='Length of the meal plan in days.'
    )
    plan_data = models.JSONField(
        help_text=(
            'Structured daily breakdown, e.g. '
            '{"day_1": {"breakfast": {...}, "lunch": {...}, "dinner": {...}}}'
        )
    )

    class Meta:
        verbose_name = 'meal plan'
        verbose_name_plural = 'meal plans'

    def __str__(self):
        return f"{self.user.email} – {self.duration_days}-day plan"
