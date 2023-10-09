#include "glitter.hpp"

// Local Headers
#include "color.h"

// Simple OpenGL Image Library
#include "SOIL2/SOIL2.h"

// System Headers
#include <glad/glad.h>
#include <GLFW/glfw3.h>

// Standard Headers
#include <cstdio>
#include <cstdlib>
#include <chrono>

// Shaders
#include "Shaders/main_vertex.glsl"
#include "Shaders/main_fragment.glsl"


void add_main_shaders(GLuint shaderProgram) {
	GLuint vertexShader = glCreateShader(GL_VERTEX_SHADER);
	glShaderSource(vertexShader, 1, &vertexSource, NULL);

	GLuint fragmentShader = glCreateShader(GL_FRAGMENT_SHADER);
	glShaderSource(fragmentShader, 1, &fragmentSource, NULL);

	glCompileShader(vertexShader);
	glCompileShader(fragmentShader);
	GLint status;
	glGetShaderiv(vertexShader, GL_COMPILE_STATUS, &status);
	if (status != GL_TRUE) {
		fprintf(stderr, "Failed to compile vertex shader\n");
	}
	glGetShaderiv(fragmentShader, GL_COMPILE_STATUS, &status);
	if (status != GL_TRUE) {
		fprintf(stderr, "Failed to compile fragment shader\n");
	}
	glAttachShader(shaderProgram, vertexShader);
	glAttachShader(shaderProgram, fragmentShader);
}

void define_vertex_attributes(GLuint shaderProgram) {
	constexpr GLint vertex_attrib_stride = 7 * sizeof(float);
	GLint posAttrib = glGetAttribLocation(shaderProgram, "position");
	glVertexAttribPointer(posAttrib, 2, GL_FLOAT, GL_FALSE, vertex_attrib_stride, 0);
	glEnableVertexAttribArray(posAttrib);
	constexpr GLint vertex_position_length = 2 * sizeof(float);

	GLint colorAttrib = glGetAttribLocation(shaderProgram, "color");
	glVertexAttribPointer(colorAttrib, 3, GL_FLOAT, GL_FALSE, vertex_attrib_stride, (void*)vertex_position_length);
	glEnableVertexAttribArray(colorAttrib);
	constexpr GLint vertex_color_length = 3 * sizeof(float);

	GLint texCoordAttrib = glGetAttribLocation(shaderProgram, "texcoord");
	glEnableVertexAttribArray(texCoordAttrib);
	glVertexAttribPointer(texCoordAttrib, 2, GL_FLOAT, GL_FALSE,
		vertex_attrib_stride, (void*)(vertex_color_length + vertex_position_length));

}

void fill_vertex_element_buffers() {
	// Set up vertex array.
	constexpr GLuint elements[] = {
		0, 1, 2,
		2, 3, 0,
	};
	constexpr float vertices[] = {
	 -0.5f,  0.5f, RED_LITERAL_FLOATS, 0.0f, 0.0f,
	  0.5f,  0.5f, GREEN_LITERAL_FLOATS, 1.0f, 0.0f,
	  0.5f, -0.5f, BLUE_LITERAL_FLOATS, 1.0f, 1.0f,
	 -0.5f, -0.5f, WHITE_LITERAL_FLOATS, 0.0f, 1.0f,
	};
	glBufferData(GL_ARRAY_BUFFER, sizeof(vertices), vertices, GL_STATIC_DRAW);
	glBufferData(GL_ELEMENT_ARRAY_BUFFER,
		sizeof(elements), elements, GL_STATIC_DRAW);

}


int main(int argc, char* argv[]) {

	// Load GLFW and Create a Window
	glfwInit();
	glfwWindowHint(GLFW_CONTEXT_VERSION_MAJOR, 4);
	glfwWindowHint(GLFW_CONTEXT_VERSION_MINOR, 0);
	glfwWindowHint(GLFW_OPENGL_PROFILE, GLFW_OPENGL_CORE_PROFILE);
	glfwWindowHint(GLFW_OPENGL_FORWARD_COMPAT, GL_TRUE);
	glfwWindowHint(GLFW_RESIZABLE, GL_FALSE);
	auto mWindow = glfwCreateWindow(mWidth, mHeight, "OpenGL", nullptr, nullptr);

	// Check for Valid Context
	if (mWindow == nullptr) {
		fprintf(stderr, "Failed to Create OpenGL Context");
		return EXIT_FAILURE;
	}

	// Create Context and Load OpenGL Functions
	glfwMakeContextCurrent(mWindow);
	gladLoadGL();
	fprintf(stderr, "OpenGL %s\n", glGetString(GL_VERSION));

	// Setup vertex arrays/buffers.
	GLuint vertex_array_ref;
	glGenVertexArrays(1, &vertex_array_ref);
	glBindVertexArray(vertex_array_ref);
	GLuint vertex_buffer_ref;
	glGenBuffers(1, &vertex_buffer_ref); // Generate 1 buffer
	glBindBuffer(GL_ARRAY_BUFFER, vertex_buffer_ref);
	GLuint ebo;
	glGenBuffers(1, &ebo);
	glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, ebo);

	// Setup textures.
	GLuint tex;
	glGenTextures(1, &tex);
	glBindTexture(GL_TEXTURE_2D, tex);
	int width, height;
	unsigned char* image =
		SOIL_load_image("sample.png", &width, &height, 0, SOIL_LOAD_RGB);
	glTexImage2D(GL_TEXTURE_2D, 0, GL_RGB, width, height, 0, GL_RGB,
		GL_UNSIGNED_BYTE, image);
	fprintf(stderr, "width: %d, height: %d\n", width, height);
	SOIL_free_image_data(image);
	// Set the first two coordinates of (s, r, t) to repeat when sampling over the texture.
	glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
	glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
	// Set border color to red.
	constexpr float color[] = { 1.0f, 0.0f, 0.0f, 1.0f };
	glTexParameterfv(GL_TEXTURE_2D, GL_TEXTURE_BORDER_COLOR, color);
	// Set filter to linear, for both downscaling and upscaling.
	glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
	glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);


	// Setup shaders.
	GLuint shaderProgram = glCreateProgram();
	add_main_shaders(shaderProgram);
	glLinkProgram(shaderProgram);
	glUseProgram(shaderProgram);
	define_vertex_attributes(shaderProgram);

	auto t_start = std::chrono::high_resolution_clock::now();

	// Background Fill Color
	glClearColor(0.25f, 0.25f, 0.25f, 1.0f);
	glClear(GL_COLOR_BUFFER_BIT);

	// Rendering Loop
	while (glfwWindowShouldClose(mWindow) == false) {
		if (glfwGetKey(mWindow, GLFW_KEY_ESCAPE) == GLFW_PRESS)
			glfwSetWindowShouldClose(mWindow, true);

		auto t_now = std::chrono::high_resolution_clock::now();
		float time = std::chrono::duration_cast<std::chrono::duration<float>>(t_now - t_start).count();

		fill_vertex_element_buffers();

		// Clear the screen to black
		glClearColor(0.0f, 0.0f, 0.0f, 1.0f);
		glClear(GL_COLOR_BUFFER_BIT);
		glDrawElements(GL_TRIANGLES, 6, GL_UNSIGNED_INT, 0);

		// Flip Buffers and Draw
		glfwSwapBuffers(mWindow);
		glfwPollEvents();
	}
	glfwTerminate();
	return EXIT_SUCCESS;
}
