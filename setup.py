from setuptools import setup, find_packages

setup(
      name="griq",
      version="1.0.0",
      packages=find_packages(),
      package_dir={"": "."},  # Ensure it looks in the current directory
      install_requires=[
          "websockets",
      ],
      entry_points={
          "console_scripts": [
              "griq = client.cli:main",
          ],
      },
      author="Sem",
      description="A lightweight HTTP tunneling service",
      url="https://github.com/sem22-dev/griq",
  )