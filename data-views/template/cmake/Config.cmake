# Configuration file for user settings
# This file should include the path for toolchain and other settings that user would like to override.
#
# Default CMAKE_FIND_ROOT_PATH for CCRH Toolchain will use RENESAS_TOOLCHAIN_PATH.
#
# User defined CCRH toolchain path.
set(RENESAS_CCRH_TOOLCHAIN_PATH "<%- ccrh_toolchain_path %>")

# Toolchain file is processed multiple times, however, it cannot access CMake cache on some runs.
# We store the search path in an environment variable so that we can always access it.
if(DEFINED RENESAS_CCRH_TOOLCHAIN_PATH AND NOT RENESAS_CCRH_TOOLCHAIN_PATH STREQUAL "")
  message("Using RENESAS_CCRH_TOOLCHAIN_PATH given with cmake settings: ${RENESAS_CCRH_TOOLCHAIN_PATH}")
  file(TO_CMAKE_PATH ${RENESAS_CCRH_TOOLCHAIN_PATH} RENESAS_TOOLCHAIN_PATH)
elseif(DEFINED ENV{RENESAS_CCRH_TOOLCHAIN_PATH} AND NOT ENV{RENESAS_CCRH_TOOLCHAIN_PATH} STREQUAL "")
  message("Using RENESAS_CCRH_TOOLCHAIN_PATH defined in environment: $ENV{RENESAS_CCRH_TOOLCHAIN_PATH}")
  file(TO_CMAKE_PATH $ENV{RENESAS_CCRH_TOOLCHAIN_PATH} RENESAS_TOOLCHAIN_PATH)
else ()
  message(FATAL_ERROR "Toolchain path not defined. Please set RENESAS_CCRH_TOOLCHAIN_PATH variable to set the toolchain's bin folder")
endif()

if(NOT "${RENESAS_TOOLCHAIN_PATH}" STREQUAL "")
    set(ENV{RENESAS_TOOLCHAIN_PATH} "${RENESAS_TOOLCHAIN_PATH}")
endif()

# Find the compiler executable and store its path in a cache entry ${compiler_path}.
# If not found, issue a fatal message and stop processing. RENESAS_TOOLCHAIN_PATH can be provided from
# commandline as additional search path.
function(find_compiler compiler_path compiler_exe)
    # Search user provided path first.
    find_program(
        ${compiler_path} ${compiler_exe}
        PATHS $ENV{RENESAS_TOOLCHAIN_PATH} PATH_SUFFIXES bin
        NO_DEFAULT_PATH
    )
    if("${${compiler_path}}" STREQUAL "${compiler_path}-NOTFOUND")
        set(RENESAS_TOOLCHAIN_PATH "" CACHE PATH "Path to search for compiler.")
        message(FATAL_ERROR "Compiler not found, you can specify search path with\
            \"RENESAS_TOOLCHAIN_PATH\".")
    endif()
endfunction()