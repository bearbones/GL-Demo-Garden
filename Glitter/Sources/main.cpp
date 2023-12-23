#include "glitter.hpp"

// Local Headers
#include "color.h"

// Loading images
#define STB_IMAGE_IMPLEMENTATION
#include "stb_image.h"

// System Headers
#include <glad/glad.h>
#include <GLFW/glfw3.h>

// Matrix utilities
#include <glm/glm.hpp>
#include <glm/gtc/matrix_transform.hpp>
#include <glm/gtc/type_ptr.hpp>

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
	constexpr GLint vertex_attrib_stride = 8 * sizeof(float);
	GLint posAttrib = glGetAttribLocation(shaderProgram, "position");
	glVertexAttribPointer(posAttrib, 3, GL_FLOAT, GL_FALSE, vertex_attrib_stride, 0);
	glEnableVertexAttribArray(posAttrib);
	constexpr GLint vertex_position_length = 3 * sizeof(float);

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
	/* Set up vertex array.
	constexpr GLuint elements[] = {
		0, 1, 2,
		2, 3, 0,
	};
	glBufferData(GL_ELEMENT_ARRAY_BUFFER,
		sizeof(elements), elements, GL_STATIC_DRAW);
	constexpr float vertices[] = {
	 -0.5f,  0.5f, 0.0f, RED_LITERAL_FLOATS, 0.0f, 0.0f,
	  0.5f,  0.5f, 0.0f, GREEN_LITERAL_FLOATS, 1.0f, 0.0f,
	  0.5f, -0.5f, 0.0f, BLUE_LITERAL_FLOATS, 1.0f, 1.0f,
	 -0.5f, -0.5f, 0.0f, WHITE_LITERAL_FLOATS, 0.0f, 1.0f,
	};
	*/
	constexpr GLfloat vertices[] = {
	-0.5f, -0.5f, -0.5f, 1.0f, 1.0f, 1.0f, 0.0f, 0.0f,
	 0.5f, -0.5f, -0.5f, 1.0f, 1.0f, 1.0f, 1.0f, 0.0f,
	 0.5f,  0.5f, -0.5f, 1.0f, 1.0f, 1.0f, 1.0f, 1.0f,
	 0.5f,  0.5f, -0.5f, 1.0f, 1.0f, 1.0f, 1.0f, 1.0f,
	-0.5f,  0.5f, -0.5f, 1.0f, 1.0f, 1.0f, 0.0f, 1.0f,
	-0.5f, -0.5f, -0.5f, 1.0f, 1.0f, 1.0f, 0.0f, 0.0f,

	-0.5f, -0.5f,  0.5f, 1.0f, 1.0f, 1.0f, 0.0f, 0.0f,
	 0.5f, -0.5f,  0.5f, 1.0f, 1.0f, 1.0f, 1.0f, 0.0f,
	 0.5f,  0.5f,  0.5f, 1.0f, 1.0f, 1.0f, 1.0f, 1.0f,
	 0.5f,  0.5f,  0.5f, 1.0f, 1.0f, 1.0f, 1.0f, 1.0f,
	-0.5f,  0.5f,  0.5f, 1.0f, 1.0f, 1.0f, 0.0f, 1.0f,
	-0.5f, -0.5f,  0.5f, 1.0f, 1.0f, 1.0f, 0.0f, 0.0f,

	-0.5f,  0.5f,  0.5f, 1.0f, 1.0f, 1.0f, 1.0f, 0.0f,
	-0.5f,  0.5f, -0.5f, 1.0f, 1.0f, 1.0f, 1.0f, 1.0f,
	-0.5f, -0.5f, -0.5f, 1.0f, 1.0f, 1.0f, 0.0f, 1.0f,
	-0.5f, -0.5f, -0.5f, 1.0f, 1.0f, 1.0f, 0.0f, 1.0f,
	-0.5f, -0.5f,  0.5f, 1.0f, 1.0f, 1.0f, 0.0f, 0.0f,
	-0.5f,  0.5f,  0.5f, 1.0f, 1.0f, 1.0f, 1.0f, 0.0f,

	 0.5f,  0.5f,  0.5f, 1.0f, 1.0f, 1.0f, 1.0f, 0.0f,
	 0.5f,  0.5f, -0.5f, 1.0f, 1.0f, 1.0f, 1.0f, 1.0f,
	 0.5f, -0.5f, -0.5f, 1.0f, 1.0f, 1.0f, 0.0f, 1.0f,
	 0.5f, -0.5f, -0.5f, 1.0f, 1.0f, 1.0f, 0.0f, 1.0f,
	 0.5f, -0.5f,  0.5f, 1.0f, 1.0f, 1.0f, 0.0f, 0.0f,
	 0.5f,  0.5f,  0.5f, 1.0f, 1.0f, 1.0f, 1.0f, 0.0f,

	-0.5f, -0.5f, -0.5f, 1.0f, 1.0f, 1.0f, 0.0f, 1.0f,
	 0.5f, -0.5f, -0.5f, 1.0f, 1.0f, 1.0f, 1.0f, 1.0f,
	 0.5f, -0.5f,  0.5f, 1.0f, 1.0f, 1.0f, 1.0f, 0.0f,
	 0.5f, -0.5f,  0.5f, 1.0f, 1.0f, 1.0f, 1.0f, 0.0f,
	-0.5f, -0.5f,  0.5f, 1.0f, 1.0f, 1.0f, 0.0f, 0.0f,
	-0.5f, -0.5f, -0.5f, 1.0f, 1.0f, 1.0f, 0.0f, 1.0f,

	-0.5f,  0.5f, -0.5f, 1.0f, 1.0f, 1.0f, 0.0f, 1.0f,
	 0.5f,  0.5f, -0.5f, 1.0f, 1.0f, 1.0f, 1.0f, 1.0f,
	 0.5f,  0.5f,  0.5f, 1.0f, 1.0f, 1.0f, 1.0f, 0.0f,
	 0.5f,  0.5f,  0.5f, 1.0f, 1.0f, 1.0f, 1.0f, 0.0f,
	-0.5f,  0.5f,  0.5f, 1.0f, 1.0f, 1.0f, 0.0f, 0.0f,
	-0.5f,  0.5f, -0.5f, 1.0f, 1.0f, 1.0f, 0.0f, 1.0f
	};
	glBufferData(GL_ARRAY_BUFFER, sizeof(vertices), vertices, GL_STATIC_DRAW);
}

void build_vertex_uniforms(GLuint shaderProgram) {
	glm::mat4 view = glm::lookAt(
		glm::vec3(1.2f, 1.2f, 1.2f),
		glm::vec3(0.0f, 0.0f, 0.0f),
		glm::vec3(0.0f, 0.0f, 1.0f)
	);
	GLint uniView = glGetUniformLocation(shaderProgram, "view");
	glUniformMatrix4fv(uniView, 1, GL_FALSE, glm::value_ptr(view));
	glm::mat4 projection = glm::perspective(glm::radians(45.0f), 1920.0f / 1080.0f, 1.0f, 10.0f);
	GLint uniProj = glGetUniformLocation(shaderProgram, "projection");
	glUniformMatrix4fv(uniProj, 1, GL_FALSE, glm::value_ptr(projection));


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

	// Configs
	// Enable Z-buffer
	glEnable(GL_DEPTH_TEST);

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
	// channels refers to color channels per pixel, so 4 is RGBA, 3 is RGB.
	int width, height, channels;
	unsigned char * image = stbi_load("sample.png", &width, &height, &channels, 0);
	glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, width, height, 0, GL_RGBA,
		GL_UNSIGNED_BYTE, image);
	fprintf(stderr, "width: %d, height: %d\n", width, height);
	stbi_image_free(image);
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
	build_vertex_uniforms(shaderProgram);
	// Frame-variant uniforms.
	GLint uniTrans = glGetUniformLocation(shaderProgram, "transform");
	auto t_start = std::chrono::high_resolution_clock::now();


	// Initialize
	glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
	// Background Fill Color
	glClearColor(0.25f, 0.25f, 0.25f, 1.0f);

	// Rendering Loop
	while (glfwWindowShouldClose(mWindow) == false) {

		if (glfwGetKey(mWindow, GLFW_KEY_ESCAPE) == GLFW_PRESS)
			glfwSetWindowShouldClose(mWindow, true);

		auto t_now = std::chrono::high_resolution_clock::now();
		float time = std::chrono::duration_cast<std::chrono::duration<float>>(t_now - t_start).count();

		fill_vertex_element_buffers();

		glm::mat4 transform = glm::mat4(1.0f);
		transform = glm::rotate(transform, glm::radians(180.0f * time), glm::vec3(0.0f, 0.0f, 1.0f));
		// transform rotates a vector 180 degrees about the Z axis.
		glUniformMatrix4fv(uniTrans, 1, GL_FALSE, glm::value_ptr(transform));
		// Clear the screen to black
		glClearColor(0.0f, 0.0f, 0.0f, 1.0f);
		glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
		glDrawArrays(GL_TRIANGLES, 0, 36);

		// Flip Buffers and Draw
		glfwSwapBuffers(mWindow);
		glfwPollEvents();
	}
	glfwTerminate();
	return EXIT_SUCCESS;
}
