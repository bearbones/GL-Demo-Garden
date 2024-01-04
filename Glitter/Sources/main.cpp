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

void fill_scene_vertex_element_buffers() {
	constexpr GLuint elements[] = {
		0, 1, 2,
		2, 3, 0,
	};
	glBufferData(GL_ELEMENT_ARRAY_BUFFER,
		sizeof(elements), elements, GL_STATIC_DRAW);
	// Vertices for a rectangle that represents the main viewport.
	constexpr float frame_vertices[] = {
	 -0.5f,  0.5f, 0.0f, RED_LITERAL_FLOATS, 0.0f, 0.0f,
	  0.5f,  0.5f, 0.0f, GREEN_LITERAL_FLOATS, 1.0f, 0.0f,
	  0.5f, -0.5f, 0.0f, BLUE_LITERAL_FLOATS, 1.0f, 1.0f,
	 -0.5f, -0.5f, 0.0f, WHITE_LITERAL_FLOATS, 0.0f, 1.0f,
	};

	constexpr GLfloat scene_vertices[] = {
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
	-0.5f,  0.5f, -0.5f, 1.0f, 1.0f, 1.0f, 0.0f, 1.0f,

	// Floor
	-1.0f, -1.0f, -0.5f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f,
	 1.0f, -1.0f, -0.5f, 0.0f, 0.0f, 0.0f, 1.0f, 0.0f,
	 1.0f,  1.0f, -0.5f, 0.0f, 0.0f, 0.0f, 1.0f, 1.0f,
	 1.0f,  1.0f, -0.5f, 0.0f, 0.0f, 0.0f, 1.0f, 1.0f,
	-1.0f,  1.0f, -0.5f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f,
	-1.0f, -1.0f, -0.5f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f
	};
	glBufferData(GL_ARRAY_BUFFER, sizeof(vertices), vertices, GL_STATIC_DRAW);
}

void build_vertex_uniforms(GLuint shaderProgram) {
	glm::mat4 view = glm::lookAt(
		glm::vec3(2.5f, 2.5f, 2.0f),
		glm::vec3(0.0f, 0.0f, 0.0f),
		glm::vec3(0.0f, 0.0f, 1.0f)
	);
	GLint uniView = glGetUniformLocation(shaderProgram, "view");
	glUniformMatrix4fv(uniView, 1, GL_FALSE, glm::value_ptr(view));
	glm::mat4 projection = glm::perspective(glm::radians(45.0f), 1920.0f / 1080.0f, 1.0f, 10.0f);
	GLint uniProj = glGetUniformLocation(shaderProgram, "projection");
	glUniformMatrix4fv(uniProj, 1, GL_FALSE, glm::value_ptr(projection));


}

// For the floor
void activate_stencil_buffer() {
	glEnable(GL_STENCIL_TEST);

	glStencilFunc(GL_ALWAYS, 1, 0xFF); // Set any stencil to 1
	glStencilOp(GL_KEEP, GL_KEEP, GL_REPLACE);
	glStencilMask(0xFF); // Write to stencil buffer
	glDepthMask(GL_FALSE); // Don't write to depth buffer
	glClear(GL_STENCIL_BUFFER_BIT); // Clear stencil buffer (0 by default)
}

void window_config() {
	// Load GLFW and Create a Window
	glfwInit();
	glfwWindowHint(GLFW_CONTEXT_VERSION_MAJOR, 4);
	glfwWindowHint(GLFW_CONTEXT_VERSION_MINOR, 0);
	glfwWindowHint(GLFW_OPENGL_PROFILE, GLFW_OPENGL_CORE_PROFILE);
	glfwWindowHint(GLFW_OPENGL_FORWARD_COMPAT, GL_TRUE);
	glfwWindowHint(GLFW_RESIZABLE, GL_FALSE);
}

int main(int argc, char* argv[]) {
	window_config();
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

	GLuint frameBuffer;
	glGenFramebuffers(1, &frameBuffer);
	glBindFramebuffer(GL_FRAMEBUFFER, frameBuffer);

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
	unsigned char* image = stbi_load("sample.png", &width, &height, &channels, 0);
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

	// Setup texture for holding a color buffer.
	GLuint texture_color_buffer;
	glGenTextures(1, &texture_color_buffer);
	glBindTexture(GL_TEXTURE_2D, texture_color_buffer);
	glTexImage2D(GL_TEXTURE_2D, 0, GL_RGB, mWidth, mHeight, 0, GL_RGB, GL_UNSIGNED_BYTE, NULL);
	glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
	glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
	// Attach texture image to the framebuffer.
	glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, texture_color_buffer, 0);

	// Render buffer object for stencil/depth image for framebuffer.
	GLuint rbo_depth_stencil;
	glGenRenderbuffers(1, &rbo_depth_stencil);
	glBindRenderbuffer(GL_RENDERBUFFER, rbo_depth_stencil);
	glRenderbufferStorage(GL_RENDERBUFFER, GL_DEPTH24_STENCIL8, mWidth, mHeight);

	// Attach stencil and depth images to framebuffer.
	glFramebufferRenderbuffer(GL_FRAMEBUFFER, GL_DEPTH_STENCIL_ATTACHMENT, GL_RENDERBUFFER, rbo_depth_stencil);

	// Setup shaders.
	GLuint shaderProgram = glCreateProgram();
	add_main_shaders(shaderProgram);
	glLinkProgram(shaderProgram);
	glUseProgram(shaderProgram);
	define_vertex_attributes(shaderProgram);
	build_vertex_uniforms(shaderProgram);
	// Frame-variant uniforms.
	GLint uniTrans = glGetUniformLocation(shaderProgram, "transform");
	GLint uniColor = glGetUniformLocation(shaderProgram, "overrideColor");
	auto t_start = std::chrono::high_resolution_clock::now();


	// Initialize
	glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
	// Background Fill Color
	glClearColor(0.75f, 0.75f, 0.75f, 1.0f);

	// Rendering Loop
	while (glfwWindowShouldClose(mWindow) == false) {

		if (glfwGetKey(mWindow, GLFW_KEY_ESCAPE) == GLFW_PRESS)
			glfwSetWindowShouldClose(mWindow, true);

		auto t_now = std::chrono::high_resolution_clock::now();
		float time = std::chrono::duration_cast<std::chrono::duration<float>>(t_now - t_start).count();

		fill_scene_vertex_element_buffers();

		// Make the internal framebuffer the render target.
		glBindFramebuffer(GL_FRAMEBUFFER, frameBuffer);
		// Clear the screen to light grey 
		glClearColor(0.75f, 0.85f, 0.95f, 1.0f);
		glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);

		glm::mat4 transform = glm::mat4(1.0f);
		glm::mat4 cube_transform = glm::rotate(transform, glm::radians(180.0f * time), glm::vec3(0.0f, 0.0f, 1.0f));
		glUniformMatrix4fv(uniTrans, 1, GL_FALSE, glm::value_ptr(cube_transform));
		// Draw top cube
		glDrawArrays(GL_TRIANGLES, 0, 36);
		// Don't let floor block reflection
		activate_stencil_buffer();
		glDepthMask(GL_FALSE);
		// Draw floor
		transform = glm::rotate(transform, glm::radians(-10.0f * time), glm::vec3(0.0f, 0.0f, 1.0f));
		glUniformMatrix4fv(uniTrans, 1, GL_FALSE, glm::value_ptr(transform));
		glDrawArrays(GL_TRIANGLES, 36, 6);

		// Draw inverted cube below floor
		cube_transform = glm::scale(
			glm::translate(cube_transform, glm::vec3(0, 0, -1)),
			glm::vec3(1, 1, -1)
		);
		glUniformMatrix4fv(uniTrans, 1, GL_FALSE, glm::value_ptr(cube_transform));
		// Don't extend reflection outside of floor
		glStencilFunc(GL_EQUAL, 1, 0xFF); // Pass test if stencil value is 1
		glStencilMask(0x00); // Don't write anything to stencil buffer
		glDepthMask(GL_TRUE);
		glUniform3f(uniColor, 0.3f, 0.3f, 0.3f);
		glDrawArrays(GL_TRIANGLES, 0, 36);
		glUniform3f(uniColor, 1.0f, 1.0f, 1.0f);
		glDisable(GL_STENCIL_TEST);

		fill_canvas_vertex_element_buffers();
		// Make the screen framebuffer the render target.
		glBindFramebuffer(GL_FRAMEBUFFER, 0);

		// Flip Buffers and Draw
		glfwSwapBuffers(mWindow);
		glfwPollEvents();
	}
	glDeleteFramebuffers(1, &frameBuffer);
	glDeleteRenderbuffers(1, &rbo_depth_stencil);
	glfwTerminate();
	return EXIT_SUCCESS;
}
