from rest_framework import serializers
from django.contrib.auth import get_user_model
from .models import SavedRecipe, RecipeIngredient, RecipeStep, UserProfile

User = get_user_model()


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=6)

    class Meta:
        model = User
        fields = ('email', 'password')

    def create(self, validated_data):
        return User.objects.create_user(**validated_data)


class SavedRecipeSerializer(serializers.ModelSerializer):
    ingredients = serializers.ListField(
        child=serializers.CharField(),
        write_only=True,
        allow_empty=True,
        required=True,
    )
    steps = serializers.ListField(
        child=serializers.CharField(),
        write_only=True,
        allow_empty=True,
        required=True,
    )

    class Meta:
        model = SavedRecipe
        fields = ('id', 'title', 'ingredients', 'steps', 'calories', 'created_at')
        read_only_fields = ('id', 'created_at')

    def create(self, validated_data):
        ingredients = validated_data.pop('ingredients', [])
        steps = validated_data.pop('steps', [])

        recipe = SavedRecipe.objects.create(**validated_data)

        RecipeIngredient.objects.bulk_create(
            [
                RecipeIngredient(recipe=recipe, order=index, text=text)
                for index, text in enumerate(ingredients, start=1)
            ]
        )
        RecipeStep.objects.bulk_create(
            [
                RecipeStep(recipe=recipe, order=index, text=text)
                for index, text in enumerate(steps, start=1)
            ]
        )

        return recipe

    def update(self, instance, validated_data):
        ingredients = validated_data.pop('ingredients', None)
        steps = validated_data.pop('steps', None)

        instance = super().update(instance, validated_data)

        if ingredients is not None:
            instance.ingredient_items.all().delete()
            RecipeIngredient.objects.bulk_create(
                [
                    RecipeIngredient(recipe=instance, order=index, text=text)
                    for index, text in enumerate(ingredients, start=1)
                ]
            )

        if steps is not None:
            instance.step_items.all().delete()
            RecipeStep.objects.bulk_create(
                [
                    RecipeStep(recipe=instance, order=index, text=text)
                    for index, text in enumerate(steps, start=1)
                ]
            )

        return instance

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data['ingredients'] = [i.text for i in instance.ingredient_items.all().order_by('order')]
        data['steps'] = [s.text for s in instance.step_items.all().order_by('order')]
        return data


class UserProfileSerializer(serializers.ModelSerializer):
    email = serializers.EmailField(source='user.email', read_only=True)

    @staticmethod
    def _normalize_csv(value):
        if not value:
            return ''

        seen = set()
        items = []
        for part in str(value).split(','):
            cleaned = part.strip()
            if not cleaned:
                continue

            dedupe_key = cleaned.casefold()
            if dedupe_key in seen:
                continue

            seen.add(dedupe_key)
            items.append(cleaned)

        return ', '.join(items)

    class Meta:
        model = UserProfile
        fields = (
            'email', 'calorie_goal',
            'allergies', 'dietary_restrictions', 'cuisine_preferences',
            'cooking_skill', 'custom_preferences',
        )
        read_only_fields = ('email',)

    def validate_allergies(self, value):
        return self._normalize_csv(value)

    def validate_dietary_restrictions(self, value):
        return self._normalize_csv(value)

    def validate_cuisine_preferences(self, value):
        return self._normalize_csv(value)


class ChangePasswordSerializer(serializers.Serializer):
    old_password = serializers.CharField(required=True, write_only=True)
    new_password = serializers.CharField(required=True, write_only=True, min_length=6)
