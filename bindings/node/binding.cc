#include <napi.h>

struct TSLanguage;
extern "C" const TSLanguage *tree_sitter_zsh();
extern "C" const TSLanguage *tree_sitter_zsh_extended_glob();

namespace {

constexpr napi_type_tag language_type_tag = {
  0x8AF2E5212AD58ABF,
  0xD5006CAD83ABBA16
};

struct Grammar {
  const char *name;
  const TSLanguage *(*language)();
};

constexpr Grammar grammars[] = {
  {"zsh", tree_sitter_zsh},
  {"zsh_extended_glob", tree_sitter_zsh_extended_glob}
};

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  for (const auto &grammar : grammars) {
    auto language = Napi::External<TSLanguage>::New(
      env,
      const_cast<TSLanguage *>(grammar.language())
    );
    language.TypeTag(&language_type_tag);
    auto binding = Napi::Object::New(env);
    binding["language"] = language;
    exports[grammar.name] = binding;
  }
  return exports;
}

}

NODE_API_MODULE(tree_sitter_zsh_binding, Init)
