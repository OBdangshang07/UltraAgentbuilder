#version 150
uniform sampler2D Sampler0;
uniform vec4 ColorModulator;
uniform float UseTexture;
in vec4 vertexColor;
in vec2 texCoord;
out vec4 fragColor;
void main() {
    vec4 texel = UseTexture > 0.5 ? texture(Sampler0, texCoord) : vec4(1.0);
    if (texel.a < 0.01) discard;
    fragColor = texel * vertexColor * ColorModulator;
}
