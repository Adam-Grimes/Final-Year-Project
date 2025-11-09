#Final Year Project - Adam Grimes

# Prep: An AI-Powered Recipe Generator and Meal Planner

> **Note:** This is my in-progress Final Year Project for the BSc (Honours) in Computer Science at Atlantic Technological University.

This project aims to solve the daily, time-consuming challenge of meal planning. "Prep" is a full-stack Android application designed to bridge the gap between your kitchen and the digital world, transforming the chore of deciding "what's for dinner" into a seamless and creative experience.

The application allows users to photograph the ingredients they already have, and then leverages AI to generate personalized recipes and weekly meal plans based on those ingredients, along with the user's dietary goals, allergies, and time constraints.

---

## 🚀 Key Features

* **Computer Vision Ingredient Scanning:** Utilizes a **YOLO** object detection model to accurately identify and list ingredients from a single photo taken by the user.
* **Generative AI Recipes:** Integrates the **Google Gemini LLM** to generate unique, personalized recipes from the list of available ingredients.
* **Personalized Meal Planning:** Generates multi-day meal plans based on user preferences, dietary goals (e.g., calorie counts), and time availability.
* **Native Android Experience:** A user-friendly and responsive native Android application built in **Kotlin**.
* **Full-Stack Architecture:** A robust backend built with the **Django REST Framework** to host the AI models and manage API requests from the app.

---

## 🛠 Tech Stack & Architecture

This project combines a native mobile frontend with a powerful Python backend to handle complex AI tasks.

* **Frontend:** Kotlin (Native Android)
* **Backend:** Python, Django REST Framework
* **Computer Vision:** YOLO (You Only Look Once)
* **Generative AI:** Google Gemini API
* **Project Management:** GitHub Project, Git
* **Development Methodology:** Agile (2-week sprints)

---

## STATUS: In Development

This project is currently in active development, following the proposed project plan.

* **Weeks 1-4:** Backend & API Development (Django REST API, YOLO & Gemini integration).
* **Weeks 5-9:** Frontend Mobile App Development (Kotlin UI/UX, API integration).
* **Weeks 10-12:** Full-stack Integration, Testing, and Documentation.

