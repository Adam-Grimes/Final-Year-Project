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
    dietary_restrictions = models.TextField(
        blank=True, default='',
        help_text='Comma-separated list of dietary preferences (e.g. Vegan, Halal).'
    )
    cuisine_preferences = models.TextField(
        blank=True, default='',
        help_text='Comma-separated list of preferred cuisines (e.g. Irish Traditional, Italian).'
    )
    cooking_skill = models.CharField(
        max_length=20, blank=True, default='Intermediate',
        help_text='Cooking skill level (Beginner, Intermediate, Chef Level).'
    )
    custom_preferences = models.TextField(
        blank=True, default='',
        help_text='Free-text additional preferences.'
    )

    class Meta:
        verbose_name = 'user profile'
        verbose_name_plural = 'user profiles'

    def __str__(self):
        return f"{self.user.email}'s profile"


class PasswordResetToken(models.Model):
    """Temporary token for password reset flow."""
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='reset_tokens')
    token = models.CharField(max_length=6)
    created_at = models.DateTimeField(auto_now_add=True)
    is_used = models.BooleanField(default=False)

    class Meta:
        ordering = ['-created_at']


class SavedRecipe(models.Model):
    """
    Stores a user's saved/favourite recipes.
    Many-to-one relationship with User.
    """
    CATEGORY_CHOICES = [
        ('breakfast', 'Breakfast'),
        ('lunch', 'Lunch'),
        ('dinner', 'Dinner'),
    ]

    user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name='saved_recipes'
    )
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True, default='')
    calories = models.IntegerField(null=True, blank=True, help_text='Estimated calorie count for the meal.')
    servings = models.IntegerField(null=True, blank=True)
    prep_time = models.CharField(max_length=50, blank=True, default='')
    cook_time = models.CharField(max_length=50, blank=True, default='')
    category = models.CharField(
        max_length=10, blank=True, null=True, choices=CATEGORY_CHOICES,
        help_text='Meal type category (breakfast, lunch, dinner).'
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = 'saved recipe'
        verbose_name_plural = 'saved recipes'
        ordering = ['-created_at']

    def __str__(self):
        return self.title


class RecipeIngredient(models.Model):
    recipe = models.ForeignKey(
        SavedRecipe, on_delete=models.CASCADE, related_name='ingredient_items'
    )
    order = models.PositiveIntegerField()
    text = models.CharField(max_length=255)

    class Meta:
        ordering = ['order']
        constraints = [
            models.UniqueConstraint(fields=['recipe', 'order'], name='uniq_recipe_ingredient_order')
        ]

    def __str__(self):
        return self.text


class RecipeStep(models.Model):
    recipe = models.ForeignKey(
        SavedRecipe, on_delete=models.CASCADE, related_name='step_items'
    )
    order = models.PositiveIntegerField()
    text = models.TextField()

    class Meta:
        ordering = ['order']
        constraints = [
            models.UniqueConstraint(fields=['recipe', 'order'], name='uniq_recipe_step_order')
        ]

    def __str__(self):
        return self.text[:60]


class MealPlan(models.Model):
    """
    Stores a multi-day meal plan for a user.
    Each day and each meal slot is stored as a separate relational row
    so individual meals can be swapped or deleted.
    """
    user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name='meal_plans'
    )
    name = models.CharField(max_length=100, default='My Meal Plan')
    duration_days = models.IntegerField(
        help_text='Length of the meal plan in days.'
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = 'meal plan'
        verbose_name_plural = 'meal plans'
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.user.email} – {self.name}"


class MealPlanDay(models.Model):
    meal_plan = models.ForeignKey(
        MealPlan, on_delete=models.CASCADE, related_name='days'
    )
    day_number = models.PositiveIntegerField()

    class Meta:
        ordering = ['day_number']
        constraints = [
            models.UniqueConstraint(
                fields=['meal_plan', 'day_number'], name='uniq_mealplan_day_number'
            )
        ]

    def __str__(self):
        return f"Day {self.day_number}"


class MealPlanMeal(models.Model):
    """One breakfast/lunch/dinner slot within a MealPlanDay."""

    MEAL_CHOICES = [
        ('breakfast', 'Breakfast'),
        ('lunch', 'Lunch'),
        ('dinner', 'Dinner'),
    ]

    day = models.ForeignKey(
        MealPlanDay, on_delete=models.CASCADE, related_name='meals'
    )
    meal_type = models.CharField(max_length=16, choices=MEAL_CHOICES)
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True, default='')
    calories = models.IntegerField(null=True, blank=True)
    servings = models.IntegerField(null=True, blank=True)
    prep_time = models.CharField(max_length=50, blank=True, default='')
    cook_time = models.CharField(max_length=50, blank=True, default='')
    ingredients = models.JSONField(default=list)
    steps = models.JSONField(default=list)
    # Set when a user swaps this slot to one of their saved recipes
    saved_recipe = models.ForeignKey(
        SavedRecipe, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='meal_plan_slots'
    )

    class Meta:
        ordering = ['day__day_number', 'meal_type']
        constraints = [
            models.UniqueConstraint(
                fields=['day', 'meal_type'], name='uniq_day_meal_type'
            )
        ]

    def __str__(self):
        return f"Day {self.day.day_number} – {self.meal_type}: {self.title}"
