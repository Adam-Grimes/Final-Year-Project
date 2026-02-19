from rest_framework import serializers
from django.contrib.auth import get_user_model
from .models import SavedRecipe

User = get_user_model()


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=6)

    class Meta:
        model = User
        fields = ('email', 'password')

    def create(self, validated_data):
        return User.objects.create_user(**validated_data)


class SavedRecipeSerializer(serializers.ModelSerializer):
    class Meta:
        model = SavedRecipe
        fields = ('id', 'title', 'ingredients', 'steps', 'calories', 'created_at')
        read_only_fields = ('id', 'created_at')
