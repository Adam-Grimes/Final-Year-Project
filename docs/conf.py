import os
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Path setup – make `api` and `core` importable
# ---------------------------------------------------------------------------
sys.path.insert(0, str(Path(__file__).parent.parent / 'backend'))

# ---------------------------------------------------------------------------
# Mock heavy ML dependencies so the docs build doesn't need GPU packages.
# autodoc_mock_imports must be declared BEFORE django.setup() because Sphinx
# applies the mocks when it later imports our modules.
# ---------------------------------------------------------------------------
autodoc_mock_imports = [
    'ultralytics',
    'torch',
    'torchvision',
    'cv2',
    'google',
    'google.generativeai',
]

# ---------------------------------------------------------------------------
# Django setup – required so that autodoc can import models / serializers
# ---------------------------------------------------------------------------
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'core.settings')
import django  # noqa: E402
django.setup()

# ---------------------------------------------------------------------------
# Project information
# ---------------------------------------------------------------------------
project = 'Prep'
copyright = '2025, Adam Grimes'
author = 'Adam Grimes'
release = '1.0'

# ---------------------------------------------------------------------------
# General configuration
# ---------------------------------------------------------------------------
extensions = [
    'sphinx.ext.autodoc',    # auto-generate docs from docstrings
    'sphinx.ext.napoleon',   # support Google-style docstrings
    'sphinx.ext.viewcode',   # add links to highlighted source
]

templates_path = ['_templates']
exclude_patterns = ['_build', 'Thumbs.db', '.DS_Store']

# ---------------------------------------------------------------------------
# Autodoc options
# ---------------------------------------------------------------------------
autodoc_default_options = {
    'members': True,
    'undoc-members': False,
    'show-inheritance': True,
    'special-members': False,
}

# Use Google-style docstrings (Args / Returns / Raises sections)
napoleon_google_docstring = True
napoleon_numpy_docstring = False
napoleon_include_init_with_doc = False
napoleon_attr_annotations = True

# ---------------------------------------------------------------------------
# HTML output
# ---------------------------------------------------------------------------
html_theme = 'sphinx_rtd_theme'
html_static_path = []

html_theme_options = {
    'navigation_depth': 3,
    'titles_only': False,
}
