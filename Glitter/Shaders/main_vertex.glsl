const char* vertexSource = R"glsl(

#version 150 core

in vec2 texcoord;
in vec3 position;
in vec3 color;
out vec3 Color;
out vec2 Texcoord;

uniform mat4 transform;
uniform mat4 view;
uniform mat4 projection;

void main()
{
  Color = color;
  Texcoord = texcoord;
  gl_Position = projection * view * transform * vec4(position, 1.0);

}
)glsl";