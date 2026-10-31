#include <Python.h>

#include "tree_sitter/parser.h"

const TSLanguage *tree_sitter_zsh(void);
const TSLanguage *tree_sitter_zsh_extended_glob(void);

static PyObject *language(PyObject *self, PyObject *args) {
  (void)self;
  (void)args;
  return PyCapsule_New((void *)tree_sitter_zsh(), "tree_sitter.Language", NULL);
}

static PyObject *language_extended_glob(PyObject *self, PyObject *args) {
  (void)self;
  (void)args;
  return PyCapsule_New(
    (void *)tree_sitter_zsh_extended_glob(),
    "tree_sitter.Language",
    NULL
  );
}

static PyMethodDef methods[] = {
  {"language", language, METH_NOARGS, "Return the zsh language capsule."},
  {"language_extended_glob",
    language_extended_glob,
    METH_NOARGS,
    "Return the zsh_extended_glob language capsule."},
  {NULL, NULL, 0, NULL},
};

static struct PyModuleDef module = {
  PyModuleDef_HEAD_INIT,
  .m_name = "binding",
  .m_size = -1,
  .m_methods = methods,
};

PyMODINIT_FUNC PyInit_binding(void) {
  return PyModule_Create(&module);
}
