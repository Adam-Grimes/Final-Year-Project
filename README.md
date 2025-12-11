# Prep: AI-Powered Recipe Generator & Meal Planner 🥗📱

> **Final Year Project** | BSc (Honours) in Computer Science  
> **Atlantic Technological University (ATU)** > **Student:** Adam Grimes

![Project Status](https://img.shields.io/badge/Status-In_Development-orange)
![License](https://img.shields.io/badge/License-MIT-blue)

## 📖 Overview

**Prep** is a full-stack mobile application designed to bridge the gap between your kitchen and the digital world, transforming the chore of deciding "what's for dinner" into a seamless and creative experience.

The application allows users to photograph the ingredients they already have. It then leverages Computer Vision and Generative AI to create personalized recipes and weekly meal plans based on those ingredients, aligning with the user's dietary goals, allergies, and time constraints.

---

## 🚀 Key Features

* **📸 Snap & Scan:** Utilizes a **YOLO** object detection model to accurately identify and list ingredients from a single photo.
* **🤖 AI Chef:** Integrates the **Google Gemini LLM** to generate unique, personalized recipes based on scanned ingredients.
* **📅 Smart Meal Planning:** Generates multi-day meal plans based on user preferences, calorie goals, and schedule.
* **📱 Cross-Platform Mobile App:** A responsive, modern interface built with **React Native Expo**.
* **⚙️ Robust API:** A custom backend built with **Django REST Framework** to handle AI processing and user data.

---

## 🛠 Tech Stack

### **Frontend (Mobile)**
* **Framework:** React Native (via Expo)
* **Language:** JavaScript/TypeScript
* **Navigation:** React Navigation

### **Backend (API & AI)**
* **Framework:** Django & Django REST Framework (DRF)
* **Language:** Python
* **Computer Vision:** YOLO (You Only Look Once) world model
* **Generative AI:** Google Gemini API
* **Database:** SQLite (Dev) / PostgreSQL (Prod)

---

## 🏗 Architecture

The system follows a standard Client-Server architecture:

1.  **Client (Expo):** Captures image and sends user preferences.
2.  **API (Django):** Receives image.
3.  **AI Layer 1 (YOLO):** Scans image and returns a list of string labels (e.g., "chicken", "pasta", "tomato").
4.  **AI Layer 2 (Gemini):** Takes the labels + user constraints and generates a structured recipe JSON.
5.  **Response:** The App renders the recipe and adds it to the planner.

---

## 📅 Development Roadmap

This project is being developed using Agile methodology with 2-week sprints.

* [x] **Weeks 1-4:** Backend Setup, Django REST API implementation, YOLO integration, Gemini API connection.
* [ ] **Weeks 5-9:** Frontend Mobile App Development (React Native UI/UX, Camera integration, API fetch).
* [ ] **Weeks 10-12:** Full-stack Integration, Unit Testing, User Testing, and Final Documentation.

---

