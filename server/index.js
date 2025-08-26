#!/usr/bin/env node

const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

console.error("Terminal AppleScript MCP server starting...");

// Constants
const APPLESCRIPT_TIMEOUT = 10000; // 10 seconds
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second

// Universal type caster for AppleScript values
function universalCast(value) {
  if (value === null || value === undefined) return null;
  
  const str = String(value).trim();
  if (str === '') return '';
  
  // Boolean
  const lower = str.toLowerCase();
  if (['true', 'yes'].includes(lower)) return true;
  if (['false', 'no'].includes(lower)) return false;
  
  // Number
  if (/^-?\d+(\.\d+)?$/.test(str)) {
    const num = Number(str);
    return Number.isInteger(num) ? num : num;
  }
  
  // List/Record - anything in braces, return as-is for AppleScript
  if (str.startsWith('{') && str.endsWith('}')) {
    return str; // AppleScript will handle the parsing
  }
  
  // Auto-detect comma-separated values that should be lists/rectangles
  if (str.includes(',') && !str.startsWith('{')) {
    const parts = str.split(',').map(p => p.trim());
    
    // Rectangle pattern: 4 numbers (x, y, width, height)
    if (parts.length === 4 && parts.every(p => /^-?\d+(\.\d+)?$/.test(p))) {
      return `{${str}}`; // Add brackets for rectangle
    }
    
    // Generic list: 2+ comma-separated values
    if (parts.length >= 2) {
      return `{${str}}`; // Add brackets for list
    }
  }
  
  // Date patterns
  if (str.startsWith('date "') || /^\d{4}-\d{2}-\d{2}/.test(str)) {
    return `date "${str}"`;
  }
  
  // String - remove quotes if present
  if ((str.startsWith('"') && str.endsWith('"')) || 
      (str.startsWith("'") && str.endsWith("'"))) {
    return str.slice(1, -1);
  }
  
  return str;
}

// Cast and escape for AppleScript injection
function castAndEscape(value) {
  const casted = universalCast(value);
  
  // If it's a string that doesn't start with {, escape it
  if (typeof casted === 'string' && !casted.startsWith('{') && !casted.startsWith('date')) {
    return escapeForAppleScript(casted);
  }
  
  // Numbers, booleans, and AppleScript literals go as-is
  return casted;
}

// Helper function to escape strings for AppleScript
function escapeForAppleScript(str) {
  if (typeof str !== "string") return str;
  return str
    .replace(/\\/g, "\\\\") // Escape backslashes first
    .replace(/"/g, '\"') // Then escape double quotes
    .replace(/\n/g, "\\n") // Escape newlines
    .replace(/\r/g, "\\r"); // Escape carriage returns
}

// Test if Terminal is available
async function checkTerminalAvailable() {
  try {
    const script = 'tell application "Terminal" to return "available"';
    const result = await executeAppleScript(script);
    return result === "available";
  } catch (error) {
    return false;
  }
}

// Execute AppleScript with retry logic
async function executeAppleScript(script, retries = MAX_RETRIES) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const { stdout, stderr } = await execFileAsync(
        "osascript",
        ["-e", script],
        {
          timeout: APPLESCRIPT_TIMEOUT,
          maxBuffer: 1024 * 1024, // 1MB buffer
        },
      );
      if (stderr) {
        console.error("AppleScript stderr:", stderr);
      }
      return stdout.trim();
    } catch (error) {
      if (attempt === retries) {
        console.error("AppleScript execution error after retries:", error);
        throw new Error(`AppleScript error: ${error.message}`);
      }
      await new Promise((resolve) =>
        setTimeout(resolve, RETRY_DELAY * Math.pow(2, attempt)),
      );
    }
  }
}

// MCP server implementation
class TerminalMCPServer {
  constructor() {
    this.initialized = false;
    this.setupStdio();
  }

  setupStdio() {
    process.stdin.setEncoding('utf8');
    
    let buffer = '';
    process.stdin.on('data', (data) => {
      buffer += data;
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer
      
      lines.forEach(line => {
        if (line.trim()) {
          this.handleMessage(line.trim());
        }
      });
    });
  }

  async handleMessage(data) {
    try {
      const request = JSON.parse(data);
      console.error("Received request:", request.method, request.id);
      
      if (request.method === 'initialize') {
        await this.handleInitialize(request);
      } else if (request.method === 'initialized') {
        await this.handleInitialized(request);
      } else if (request.method === 'tools/list') {
        await this.handleToolsList(request);
      } else if (request.method === 'tools/call') {
        await this.handleToolsCall(request);
      } else {
        console.error("Unknown method:", request.method);
      }
    } catch (error) {
      console.error("Error processing message:", error);
    }
  }

  async handleInitialize(request) {
    console.error("Handling initialize request");
    const response = {
      jsonrpc: '2.0',
      id: request.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {}
        },
        serverInfo: {
          name: 'terminal-applescript',
          version: '0.1.0'
        }
      }
    };
    this.sendResponse(response);
  }

  async handleInitialized(request) {
    console.error("Handling initialized notification");
    this.initialized = true;
  }

  async handleToolsList(request) {
    console.error("Handling tools/list request");
    const response = {
      jsonrpc: '2.0',
      id: request.id,
      result: {
        tools: [
          {
  name: 'get_name_of_application',
  description: 'Get The name of the application.',
  inputSchema: {
    type: 'object',
    properties: {
      target_application_required_string: {
        type: 'string',
        description: 'The application object'
      }
    },
    required: ['target_application_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'get_frontmost_of_application',
  description: 'Get Is this the active application?',
  inputSchema: {
    type: 'object',
    properties: {
      target_application_required_string: {
        type: 'string',
        description: 'The application object'
      }
    },
    required: ['target_application_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'get_version_of_application',
  description: 'Get The version number of the application.',
  inputSchema: {
    type: 'object',
    properties: {
      target_application_required_string: {
        type: 'string',
        description: 'The application object'
      }
    },
    required: ['target_application_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'get_name_of_document',
  description: 'Get Its name. of document',
  inputSchema: {
    type: 'object',
    properties: {
      target_document_required_string: {
        type: 'string',
        description: 'The document object'
      }
    },
    required: ['target_document_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'get_modified_of_document',
  description: 'Get Has it been modified since the last save? of document',
  inputSchema: {
    type: 'object',
    properties: {
      target_document_required_string: {
        type: 'string',
        description: 'The document object'
      }
    },
    required: ['target_document_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'get_file_of_document',
  description: 'Get Its location on disk, if it has one. of document',
  inputSchema: {
    type: 'object',
    properties: {
      target_document_required_string: {
        type: 'string',
        description: 'The document object'
      }
    },
    required: ['target_document_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'get_name_of_window',
  description: 'Get The title of the window.',
  inputSchema: {
    type: 'object',
    properties: {
      target_window_required_string: {
        type: 'string',
        description: 'The window object'
      }
    },
    required: ['target_window_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'get_id_of_window',
  description: 'Get The unique identifier of the window.',
  inputSchema: {
    type: 'object',
    properties: {
      target_window_required_string: {
        type: 'string',
        description: 'The window object'
      }
    },
    required: ['target_window_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'get_index_of_window',
  description: 'Get The index of the window, ordered front to back.',
  inputSchema: {
    type: 'object',
    properties: {
      target_window_required_string: {
        type: 'string',
        description: 'The window object'
      }
    },
    required: ['target_window_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'set_index_of_window',
  description: 'Set The index of the window, ordered front to back.',
  inputSchema: {
    type: 'object',
    properties: {
      target_window_required_string: {
        type: 'string',
        description: 'The window object'
      },
      value_required_integer: {
        type: 'number',
        description: 'New value for The index of the window, ordered front to back.'
      }
    },
    required: ['target_window_required_string', 'value_required_integer'],
    additionalProperties: false
  }
},
          {
  name: 'get_bounds_of_window',
  description: 'Get The bounding rectangle of the window.',
  inputSchema: {
    type: 'object',
    properties: {
      target_window_required_string: {
        type: 'string',
        description: 'The window object'
      }
    },
    required: ['target_window_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'set_bounds_of_window',
  description: 'Set The bounding rectangle of the window.',
  inputSchema: {
    type: 'object',
    properties: {
      target_window_required_string: {
        type: 'string',
        description: 'The window object'
      },
      value_required_rectangle: {
        type: 'string',
        description: 'New value for The bounding rectangle of the window.'
      }
    },
    required: ['target_window_required_string', 'value_required_rectangle'],
    additionalProperties: false
  }
},
          {
  name: 'get_closeable_of_window',
  description: 'Get Does the window have a close button?',
  inputSchema: {
    type: 'object',
    properties: {
      target_window_required_string: {
        type: 'string',
        description: 'The window object'
      }
    },
    required: ['target_window_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'get_miniaturizable_of_window',
  description: 'Get Does the window have a minimize button?',
  inputSchema: {
    type: 'object',
    properties: {
      target_window_required_string: {
        type: 'string',
        description: 'The window object'
      }
    },
    required: ['target_window_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'get_miniaturized_of_window',
  description: 'Get Is the window minimized right now?',
  inputSchema: {
    type: 'object',
    properties: {
      target_window_required_string: {
        type: 'string',
        description: 'The window object'
      }
    },
    required: ['target_window_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'set_miniaturized_of_window',
  description: 'Set Is the window minimized right now?',
  inputSchema: {
    type: 'object',
    properties: {
      target_window_required_string: {
        type: 'string',
        description: 'The window object'
      },
      value_required_boolean: {
        type: 'boolean',
        description: 'New value for Is the window minimized right now?'
      }
    },
    required: ['target_window_required_string', 'value_required_boolean'],
    additionalProperties: false
  }
},
          {
  name: 'get_resizable_of_window',
  description: 'Get Can the window be resized?',
  inputSchema: {
    type: 'object',
    properties: {
      target_window_required_string: {
        type: 'string',
        description: 'The window object'
      }
    },
    required: ['target_window_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'get_visible_of_window',
  description: 'Get Is the window visible right now?',
  inputSchema: {
    type: 'object',
    properties: {
      target_window_required_string: {
        type: 'string',
        description: 'The window object'
      }
    },
    required: ['target_window_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'set_visible_of_window',
  description: 'Set Is the window visible right now?',
  inputSchema: {
    type: 'object',
    properties: {
      target_window_required_string: {
        type: 'string',
        description: 'The window object'
      },
      value_required_boolean: {
        type: 'boolean',
        description: 'New value for Is the window visible right now?'
      }
    },
    required: ['target_window_required_string', 'value_required_boolean'],
    additionalProperties: false
  }
},
          {
  name: 'get_zoomable_of_window',
  description: 'Get Does the window have a zoom button?',
  inputSchema: {
    type: 'object',
    properties: {
      target_window_required_string: {
        type: 'string',
        description: 'The window object'
      }
    },
    required: ['target_window_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'get_zoomed_of_window',
  description: 'Get Is the window zoomed right now?',
  inputSchema: {
    type: 'object',
    properties: {
      target_window_required_string: {
        type: 'string',
        description: 'The window object'
      }
    },
    required: ['target_window_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'set_zoomed_of_window',
  description: 'Set Is the window zoomed right now?',
  inputSchema: {
    type: 'object',
    properties: {
      target_window_required_string: {
        type: 'string',
        description: 'The window object'
      },
      value_required_boolean: {
        type: 'boolean',
        description: 'New value for Is the window zoomed right now?'
      }
    },
    required: ['target_window_required_string', 'value_required_boolean'],
    additionalProperties: false
  }
},
          {
  name: 'get_document_of_window',
  description: 'Get The document whose contents are displayed in the window.',
  inputSchema: {
    type: 'object',
    properties: {
      target_window_required_string: {
        type: 'string',
        description: 'The window object'
      }
    },
    required: ['target_window_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'open',
  description: 'Open a document.',
  inputSchema: {
    type: 'object',
    properties: {
      direct_parameter_required_list_of_file: {
        type: 'string',
        description: 'The file(s) to be opened.'
      }
    },
    required: ['direct_parameter_required_list_of_file'],
    additionalProperties: false
  }
},
          {
  name: 'close_for_document',
  description: 'Close a document.',
  inputSchema: {
    type: 'object',
    properties: {
      target_document_required_string: {
        type: 'string',
        description: 'The document object'
      },
      saving_optional_save_options: {
        type: 'string',
        description: 'Whether or not changes should be saved before closing.'
      },
      saving_in_optional_file: {
        type: 'string',
        description: 'The file in which to save the document.'
      }
    },
    required: ['target_document_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'close_for_window',
  description: 'Close a window.',
  inputSchema: {
    type: 'object',
    properties: {
      target_window_required_string: {
        type: 'string',
        description: 'The window object'
      },
      saving_optional_save_options: {
        type: 'string',
        description: 'Whether or not changes should be saved before closing.'
      },
      saving_in_optional_file: {
        type: 'string',
        description: 'The file in which to save the document.'
      }
    },
    required: ['target_window_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'save_for_document',
  description: 'Save a document.',
  inputSchema: {
    type: 'object',
    properties: {
      target_document_required_string: {
        type: 'string',
        description: 'The document object'
      },
      inParam_optional_file: {
        type: 'string',
        description: 'The file in which to save the document.'
      }
    },
    required: ['target_document_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'save_for_window',
  description: 'Save a window.',
  inputSchema: {
    type: 'object',
    properties: {
      target_window_required_string: {
        type: 'string',
        description: 'The window object'
      },
      inParam_optional_file: {
        type: 'string',
        description: 'The file in which to save the document.'
      }
    },
    required: ['target_window_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'print_file',
  description: 'Print a document. (file input)',
  inputSchema: {
    type: 'object',
    properties: {
      direct_parameter_required_list_of_file: {
        type: 'string',
        description: 'The file(s), document(s), or window(s) to be printed.'
      },
      with_properties_optional_print_settings: {
        type: 'string',
        description: 'The print settings to use.'
      },
      print_dialog_optional_boolean: {
        type: 'boolean',
        description: 'Should the application show the print dialog?'
      }
    },
    required: ['direct_parameter_required_list_of_file'],
    additionalProperties: false
  }
},
          {
  name: 'print_for_document',
  description: 'Print a document.',
  inputSchema: {
    type: 'object',
    properties: {
      target_document_required_string: {
        type: 'string',
        description: 'The document object'
      },
      with_properties_optional_print_settings: {
        type: 'string',
        description: 'The print settings to use.'
      },
      print_dialog_optional_boolean: {
        type: 'boolean',
        description: 'Should the application show the print dialog?'
      }
    },
    required: ['target_document_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'print_for_window',
  description: 'Print a window.',
  inputSchema: {
    type: 'object',
    properties: {
      target_window_required_string: {
        type: 'string',
        description: 'The window object'
      },
      with_properties_optional_print_settings: {
        type: 'string',
        description: 'The print settings to use.'
      },
      print_dialog_optional_boolean: {
        type: 'boolean',
        description: 'Should the application show the print dialog?'
      }
    },
    required: ['target_window_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'quit',
  description: 'Quit the application.',
  inputSchema: {
    type: 'object',
    properties: {
      saving_optional_save_options: {
        type: 'string',
        description: 'Whether or not changed documents should be saved before closing.'
      }
    },
    additionalProperties: false
  }
},
          {
  name: 'count_document',
  description: 'Return the number of elements of a particular class within a document.',
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false
  }
},
          {
  name: 'count_tab_of_window',
  description: 'Return the number of elements of a particular class within a tab of window.',
  inputSchema: {
    type: 'object',
    properties: {
      target_window_required_string: {
        type: 'string',
        description: 'The window object to access'
      }
    },
    required: ['target_window_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'count_settings_set',
  description: 'Return the number of elements of a particular class within a settings set.',
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false
  }
},
          {
  name: 'count_window',
  description: 'Return the number of elements of a particular class within a window.',
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false
  }
},
          {
  name: 'delete',
  description: 'Delete an object.',
  inputSchema: {
    type: 'object',
    properties: {
      direct_parameter_required_specifier: {
        type: 'string',
        description: 'the object to delete'
      }
    },
    required: ['direct_parameter_required_specifier'],
    additionalProperties: false
  }
},
          {
  name: 'duplicate',
  description: 'Copy object(s) and put the copies at a new location.',
  inputSchema: {
    type: 'object',
    properties: {
      direct_parameter_required_specifier: {
        type: 'string',
        description: 'the object(s) to duplicate'
      },
      to_required_location_specifier: {
        type: 'string',
        description: 'The location for the new object(s).'
      },
      with_properties_optional_record: {
        type: 'string',
        description: 'Properties to be set in the new duplicated object(s).'
      }
    },
    required: ['direct_parameter_required_specifier', 'to_required_location_specifier'],
    additionalProperties: false
  }
},
          {
  name: 'exists',
  description: 'Verify if an object exists.',
  inputSchema: {
    type: 'object',
    properties: {
      direct_parameter_required_specifier: {
        type: 'string',
        description: 'the object in question'
      }
    },
    required: ['direct_parameter_required_specifier'],
    additionalProperties: false
  }
},
          {
  name: 'make_document',
  description: 'Make a new document.',
  inputSchema: {
    type: 'object',
    properties: {
      at_optional_location_specifier: {
        type: 'string',
        description: 'The location at which to insert the object.'
      },
      with_data_optional_any: {
        type: 'string',
        description: 'The initial contents of the object.'
      }
    },
    additionalProperties: false
  }
},
          {
  name: 'make_tab_of_window',
  description: 'Make a new tab of window.',
  inputSchema: {
    type: 'object',
    properties: {
      at_required_location_specifier_window: {
        type: 'string',
        description: 'The window location where the tab should be created'
      },
      with_data_optional_any: {
        type: 'string',
        description: 'The initial contents of the object.'
      },
      with_properties_optional_text_font_name: {
        type: 'string',
        description: 'Optional font name property: The name of the font used to display the tab’s contents.'
      },
      with_properties_optional_color_cursor_color: {
        type: 'string',
        description: 'Optional cursor color property: The cursor color for the tab.'
      },
      with_properties_optional_boolean_title_displays_custom_title: {
        type: 'boolean',
        description: 'Optional title displays custom title property: Whether the title contains a custom title.'
      },
      with_properties_optional_text_custom_title: {
        type: 'string',
        description: 'Optional custom title property: The tab’s custom title.'
      },
      with_properties_optional_color_background_color: {
        type: 'string',
        description: 'Optional background color property: The background color for the tab.'
      },
      with_properties_optional_color_bold_text_color: {
        type: 'string',
        description: 'Optional bold text color property: The bold text color for the tab.'
      },
      with_properties_optional_boolean_title_displays_file_name: {
        type: 'boolean',
        description: 'Optional title displays file name property: Whether the title contains the file name.'
      },
      with_properties_optional_boolean_title_displays_device_name: {
        type: 'boolean',
        description: 'Optional title displays device name property: Whether the title contains the device name.'
      },
      with_properties_optional_integer_number_of_columns: {
        type: 'number',
        description: 'Optional number of columns property: The number of columns displayed in the tab.'
      },
      with_properties_optional_integer_number_of_rows: {
        type: 'number',
        description: 'Optional number of rows property: The number of rows displayed in the tab.'
      },
      with_properties_optional_boolean_title_displays_shell_path: {
        type: 'boolean',
        description: 'Optional title displays shell path property: Whether the title contains the shell path.'
      },
      with_properties_optional_color_normal_text_color: {
        type: 'string',
        description: 'Optional normal text color property: The normal text color for the tab.'
      },
      with_properties_optional_missing_value_clean_commands: {
        type: 'string',
        description: 'Optional clean commands property: The processes which will be ignored when checking whether a tab can be closed without showing a prompt.'
      },
      with_properties_optional_boolean_selected: {
        type: 'boolean',
        description: 'Optional selected property: Whether the tab is selected.'
      },
      with_properties_optional_integer_font_size: {
        type: 'number',
        description: 'Optional font size property: The size of the font used to display the tab’s contents.'
      },
      with_properties_optional_boolean_font_antialiasing: {
        type: 'boolean',
        description: 'Optional font antialiasing property: Whether the font used to display the tab’s contents is antialiased.'
      },
      with_properties_optional_settings_set_current_settings: {
        type: 'string',
        description: 'Optional current settings property: The set of settings which control the tab’s behavior and appearance.'
      },
      with_properties_optional_boolean_title_displays_window_size: {
        type: 'boolean',
        description: 'Optional title displays window size property: Whether the title contains the tab’s size, in rows and columns.'
      }
    },
    required: ['at_required_location_specifier_window'],
    additionalProperties: false
  }
},
          {
  name: 'make_settings_set',
  description: 'Make a new settings set.',
  inputSchema: {
    type: 'object',
    properties: {
      at_optional_location_specifier: {
        type: 'string',
        description: 'The location at which to insert the object.'
      },
      with_data_optional_any: {
        type: 'string',
        description: 'The initial contents of the object.'
      },
      with_properties_optional_color_bold_text_color: {
        type: 'string',
        description: 'Optional bold text color property: The bold text color for the tab.'
      },
      with_properties_optional_integer_number_of_columns: {
        type: 'number',
        description: 'Optional number of columns property: The number of columns displayed in the tab.'
      },
      with_properties_optional_boolean_title_displays_shell_path: {
        type: 'boolean',
        description: 'Optional title displays shell path property: Whether the title contains the shell path.'
      },
      with_properties_optional_boolean_title_displays_window_size: {
        type: 'boolean',
        description: 'Optional title displays window size property: Whether the title contains the tab’s size, in rows and columns.'
      },
      with_properties_optional_color_cursor_color: {
        type: 'string',
        description: 'Optional cursor color property: The cursor color for the tab.'
      },
      with_properties_optional_boolean_font_antialiasing: {
        type: 'boolean',
        description: 'Optional font antialiasing property: Whether the font used to display the tab’s contents is antialiased.'
      },
      with_properties_optional_missing_value_clean_commands: {
        type: 'string',
        description: 'Optional clean commands property: The processes which will be ignored when checking whether a tab can be closed without showing a prompt.'
      },
      with_properties_optional_color_background_color: {
        type: 'string',
        description: 'Optional background color property: The background color for the tab.'
      },
      with_properties_optional_text_font_name: {
        type: 'string',
        description: 'Optional font name property: The name of the font used to display the tab’s contents.'
      },
      with_properties_optional_integer_font_size: {
        type: 'number',
        description: 'Optional font size property: The size of the font used to display the tab’s contents.'
      },
      with_properties_optional_boolean_title_displays_settings_name: {
        type: 'boolean',
        description: 'Optional title displays settings name property: Whether the title contains the settings name.'
      },
      with_properties_optional_integer_number_of_rows: {
        type: 'number',
        description: 'Optional number of rows property: The number of rows displayed in the tab.'
      },
      with_properties_optional_boolean_title_displays_custom_title: {
        type: 'boolean',
        description: 'Optional title displays custom title property: Whether the title contains a custom title.'
      },
      with_properties_optional_text_custom_title: {
        type: 'string',
        description: 'Optional custom title property: The tab’s custom title.'
      },
      with_properties_optional_boolean_title_displays_device_name: {
        type: 'boolean',
        description: 'Optional title displays device name property: Whether the title contains the device name.'
      },
      with_properties_optional_color_normal_text_color: {
        type: 'string',
        description: 'Optional normal text color property: The normal text color for the tab.'
      },
      with_properties_optional_text_name: {
        type: 'string',
        description: 'Optional name property: The name of the settings set.'
      }
    },
    additionalProperties: false
  }
},
          {
  name: 'make_window',
  description: 'Make a new window.',
  inputSchema: {
    type: 'object',
    properties: {
      at_optional_location_specifier: {
        type: 'string',
        description: 'The location at which to insert the object.'
      },
      with_data_optional_any: {
        type: 'string',
        description: 'The initial contents of the object.'
      },
      with_properties_optional_integer_index: {
        type: 'number',
        description: 'Optional index property: The index of the window, ordered front to back.'
      },
      with_properties_optional_point_position: {
        type: 'string',
        description: 'Optional position property: The position of the window, relative to the upper left corner of the screen.'
      },
      with_properties_optional_rectangle_frame: {
        type: 'string',
        description: 'Optional frame property: The bounding rectangle, relative to the lower left corner of the screen.'
      },
      with_properties_optional_boolean_frontmost: {
        type: 'boolean',
        description: 'Optional frontmost property: Whether the window is currently the frontmost Terminal window.'
      },
      with_properties_optional_boolean_zoomed: {
        type: 'boolean',
        description: 'Optional zoomed property: Whether the window is currently zoomed.'
      },
      with_properties_optional_boolean_miniaturized: {
        type: 'boolean',
        description: 'Optional miniaturized property: Whether the window is currently minimized.'
      },
      with_properties_optional_point_size: {
        type: 'string',
        description: 'Optional size property: The width and height of the window'
      },
      with_properties_optional_boolean_visible: {
        type: 'boolean',
        description: 'Optional visible property: Whether the window is currently visible.'
      },
      with_properties_optional_point_origin: {
        type: 'string',
        description: 'Optional origin property: The position of the window, relative to the lower left corner of the screen.'
      },
      with_properties_optional_rectangle_bounds: {
        type: 'string',
        description: 'Optional bounds property: The bounding rectangle of the window.'
      }
    },
    additionalProperties: false
  }
},
          {
  name: 'move',
  description: 'Move object(s) to a new location.',
  inputSchema: {
    type: 'object',
    properties: {
      direct_parameter_required_specifier: {
        type: 'string',
        description: 'the object(s) to move'
      },
      to_required_location_specifier: {
        type: 'string',
        description: 'The new location for the object(s).'
      }
    },
    required: ['direct_parameter_required_specifier', 'to_required_location_specifier'],
    additionalProperties: false
  }
},
          {
  name: 'get_frontmost_of_window',
  description: 'Get Whether the window is currently the frontmost Terminal window.',
  inputSchema: {
    type: 'object',
    properties: {
      target_window_required_string: {
        type: 'string',
        description: 'The window object'
      }
    },
    required: ['target_window_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'set_frontmost_of_window',
  description: 'Set Whether the window is currently the frontmost Terminal window.',
  inputSchema: {
    type: 'object',
    properties: {
      target_window_required_string: {
        type: 'string',
        description: 'The window object'
      },
      value_required_boolean: {
        type: 'boolean',
        description: 'New value for Whether the window is currently the frontmost Terminal window.'
      }
    },
    required: ['target_window_required_string', 'value_required_boolean'],
    additionalProperties: false
  }
},
          {
  name: 'get_position_of_window',
  description: 'Get The position of the window, relative to the upper left corner of the screen.',
  inputSchema: {
    type: 'object',
    properties: {
      target_window_required_string: {
        type: 'string',
        description: 'The window object'
      }
    },
    required: ['target_window_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'set_position_of_window',
  description: 'Set The position of the window, relative to the upper left corner of the screen.',
  inputSchema: {
    type: 'object',
    properties: {
      target_window_required_string: {
        type: 'string',
        description: 'The window object'
      },
      value_required_point: {
        type: 'string',
        description: 'New value for The position of the window, relative to the upper left corner of the screen.'
      }
    },
    required: ['target_window_required_string', 'value_required_point'],
    additionalProperties: false
  }
},
          {
  name: 'get_origin_of_window',
  description: 'Get The position of the window, relative to the lower left corner of the screen.',
  inputSchema: {
    type: 'object',
    properties: {
      target_window_required_string: {
        type: 'string',
        description: 'The window object'
      }
    },
    required: ['target_window_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'set_origin_of_window',
  description: 'Set The position of the window, relative to the lower left corner of the screen.',
  inputSchema: {
    type: 'object',
    properties: {
      target_window_required_string: {
        type: 'string',
        description: 'The window object'
      },
      value_required_point: {
        type: 'string',
        description: 'New value for The position of the window, relative to the lower left corner of the screen.'
      }
    },
    required: ['target_window_required_string', 'value_required_point'],
    additionalProperties: false
  }
},
          {
  name: 'get_size_of_window',
  description: 'Get The width and height of the window',
  inputSchema: {
    type: 'object',
    properties: {
      target_window_required_string: {
        type: 'string',
        description: 'The window object'
      }
    },
    required: ['target_window_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'set_size_of_window',
  description: 'Set The width and height of the window',
  inputSchema: {
    type: 'object',
    properties: {
      target_window_required_string: {
        type: 'string',
        description: 'The window object'
      },
      value_required_point: {
        type: 'string',
        description: 'New value for The width and height of the window'
      }
    },
    required: ['target_window_required_string', 'value_required_point'],
    additionalProperties: false
  }
},
          {
  name: 'get_frame_of_window',
  description: 'Get The bounding rectangle, relative to the lower left corner of the screen. of window',
  inputSchema: {
    type: 'object',
    properties: {
      target_window_required_string: {
        type: 'string',
        description: 'The window object'
      }
    },
    required: ['target_window_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'set_frame_of_window',
  description: 'Set The bounding rectangle, relative to the lower left corner of the screen. of window',
  inputSchema: {
    type: 'object',
    properties: {
      target_window_required_string: {
        type: 'string',
        description: 'The window object'
      },
      value_required_rectangle: {
        type: 'string',
        description: 'New value for The bounding rectangle, relative to the lower left corner of the screen.'
      }
    },
    required: ['target_window_required_string', 'value_required_rectangle'],
    additionalProperties: false
  }
},
          {
  name: 'do_script',
  description: 'Runs a UNIX shell script or command.',
  inputSchema: {
    type: 'object',
    properties: {
      direct_parameter_optional_text: {
        type: 'string',
        description: 'The command to execute.'
      },
      with_command_optional_text: {
        type: 'string',
        description: 'Data to be passed to the Terminal application as the command line. Deprecated; use direct parameter instead.'
      },
      inParam_optional_tab: {
        type: 'string',
        description: 'The tab in which to execute the command'
      }
    },
    additionalProperties: false
  }
},
          {
  name: 'get_url',
  description: 'Open a command an ssh, telnet, or x-man-page URL.',
  inputSchema: {
    type: 'object',
    properties: {
      direct_parameter_required_text: {
        type: 'string',
        description: 'The URL to open.'
      }
    },
    required: ['direct_parameter_required_text'],
    additionalProperties: false
  }
},
          {
  name: 'get_default_settings_of_application',
  description: 'Get The settings set used for new windows. of application',
  inputSchema: {
    type: 'object',
    properties: {
      target_application_required_string: {
        type: 'string',
        description: 'The application object'
      }
    },
    required: ['target_application_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'set_default_settings_of_application',
  description: 'Set The settings set used for new windows. of application',
  inputSchema: {
    type: 'object',
    properties: {
      target_application_required_string: {
        type: 'string',
        description: 'The application object'
      },
      value_required_settings_set: {
        type: 'string',
        description: 'New value for The settings set used for new windows.'
      }
    },
    required: ['target_application_required_string', 'value_required_settings_set'],
    additionalProperties: false
  }
},
          {
  name: 'get_startup_settings_of_application',
  description: 'Get The settings set used for the window created on application startup.',
  inputSchema: {
    type: 'object',
    properties: {
      target_application_required_string: {
        type: 'string',
        description: 'The application object'
      }
    },
    required: ['target_application_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'set_startup_settings_of_application',
  description: 'Set The settings set used for the window created on application startup.',
  inputSchema: {
    type: 'object',
    properties: {
      target_application_required_string: {
        type: 'string',
        description: 'The application object'
      },
      value_required_settings_set: {
        type: 'string',
        description: 'New value for The settings set used for the window created on application startup.'
      }
    },
    required: ['target_application_required_string', 'value_required_settings_set'],
    additionalProperties: false
  }
},
          {
  name: 'get_id_of_settings_set',
  description: 'Get The unique identifier of the settings set.',
  inputSchema: {
    type: 'object',
    properties: {
      target_settings_set_required_string: {
        type: 'string',
        description: 'The settings set object'
      }
    },
    required: ['target_settings_set_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'get_name_of_settings_set',
  description: 'Get The name of the settings set.',
  inputSchema: {
    type: 'object',
    properties: {
      target_settings_set_required_string: {
        type: 'string',
        description: 'The settings set object'
      }
    },
    required: ['target_settings_set_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'set_name_of_settings_set',
  description: 'Set The name of the settings set.',
  inputSchema: {
    type: 'object',
    properties: {
      target_settings_set_required_string: {
        type: 'string',
        description: 'The settings set object'
      },
      value_required_text: {
        type: 'string',
        description: 'New value for The name of the settings set.'
      }
    },
    required: ['target_settings_set_required_string', 'value_required_text'],
    additionalProperties: false
  }
},
          {
  name: 'get_number_of_rows_of_settings_set',
  description: 'Get The number of rows displayed in the tab. of settings set',
  inputSchema: {
    type: 'object',
    properties: {
      target_settings_set_required_string: {
        type: 'string',
        description: 'The settings set object'
      }
    },
    required: ['target_settings_set_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'set_number_of_rows_of_settings_set',
  description: 'Set The number of rows displayed in the tab. of settings set',
  inputSchema: {
    type: 'object',
    properties: {
      target_settings_set_required_string: {
        type: 'string',
        description: 'The settings set object'
      },
      value_required_integer: {
        type: 'number',
        description: 'New value for The number of rows displayed in the tab.'
      }
    },
    required: ['target_settings_set_required_string', 'value_required_integer'],
    additionalProperties: false
  }
},
          {
  name: 'get_number_of_columns_of_settings_set',
  description: 'Get The number of columns displayed in the tab. of settings set',
  inputSchema: {
    type: 'object',
    properties: {
      target_settings_set_required_string: {
        type: 'string',
        description: 'The settings set object'
      }
    },
    required: ['target_settings_set_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'set_number_of_columns_of_settings_set',
  description: 'Set The number of columns displayed in the tab. of settings set',
  inputSchema: {
    type: 'object',
    properties: {
      target_settings_set_required_string: {
        type: 'string',
        description: 'The settings set object'
      },
      value_required_integer: {
        type: 'number',
        description: 'New value for The number of columns displayed in the tab.'
      }
    },
    required: ['target_settings_set_required_string', 'value_required_integer'],
    additionalProperties: false
  }
},
          {
  name: 'get_cursor_color_of_settings_set',
  description: 'Get The cursor color for the tab. of settings set',
  inputSchema: {
    type: 'object',
    properties: {
      target_settings_set_required_string: {
        type: 'string',
        description: 'The settings set object'
      }
    },
    required: ['target_settings_set_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'set_cursor_color_of_settings_set',
  description: 'Set The cursor color for the tab. of settings set',
  inputSchema: {
    type: 'object',
    properties: {
      target_settings_set_required_string: {
        type: 'string',
        description: 'The settings set object'
      },
      value_required_color: {
        type: 'string',
        description: 'New value for The cursor color for the tab.'
      }
    },
    required: ['target_settings_set_required_string', 'value_required_color'],
    additionalProperties: false
  }
},
          {
  name: 'get_background_color_of_settings_set',
  description: 'Get The background color for the tab. of settings set',
  inputSchema: {
    type: 'object',
    properties: {
      target_settings_set_required_string: {
        type: 'string',
        description: 'The settings set object'
      }
    },
    required: ['target_settings_set_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'set_background_color_of_settings_set',
  description: 'Set The background color for the tab. of settings set',
  inputSchema: {
    type: 'object',
    properties: {
      target_settings_set_required_string: {
        type: 'string',
        description: 'The settings set object'
      },
      value_required_color: {
        type: 'string',
        description: 'New value for The background color for the tab.'
      }
    },
    required: ['target_settings_set_required_string', 'value_required_color'],
    additionalProperties: false
  }
},
          {
  name: 'get_normal_text_color_of_settings_set',
  description: 'Get The normal text color for the tab. of settings set',
  inputSchema: {
    type: 'object',
    properties: {
      target_settings_set_required_string: {
        type: 'string',
        description: 'The settings set object'
      }
    },
    required: ['target_settings_set_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'set_normal_text_color_of_settings_set',
  description: 'Set The normal text color for the tab. of settings set',
  inputSchema: {
    type: 'object',
    properties: {
      target_settings_set_required_string: {
        type: 'string',
        description: 'The settings set object'
      },
      value_required_color: {
        type: 'string',
        description: 'New value for The normal text color for the tab.'
      }
    },
    required: ['target_settings_set_required_string', 'value_required_color'],
    additionalProperties: false
  }
},
          {
  name: 'get_bold_text_color_of_settings_set',
  description: 'Get The bold text color for the tab. of settings set',
  inputSchema: {
    type: 'object',
    properties: {
      target_settings_set_required_string: {
        type: 'string',
        description: 'The settings set object'
      }
    },
    required: ['target_settings_set_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'set_bold_text_color_of_settings_set',
  description: 'Set The bold text color for the tab. of settings set',
  inputSchema: {
    type: 'object',
    properties: {
      target_settings_set_required_string: {
        type: 'string',
        description: 'The settings set object'
      },
      value_required_color: {
        type: 'string',
        description: 'New value for The bold text color for the tab.'
      }
    },
    required: ['target_settings_set_required_string', 'value_required_color'],
    additionalProperties: false
  }
},
          {
  name: 'get_font_name_of_settings_set',
  description: 'Get The name of the font used to display the tab’s contents. of settings set',
  inputSchema: {
    type: 'object',
    properties: {
      target_settings_set_required_string: {
        type: 'string',
        description: 'The settings set object'
      }
    },
    required: ['target_settings_set_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'set_font_name_of_settings_set',
  description: 'Set The name of the font used to display the tab’s contents. of settings set',
  inputSchema: {
    type: 'object',
    properties: {
      target_settings_set_required_string: {
        type: 'string',
        description: 'The settings set object'
      },
      value_required_text: {
        type: 'string',
        description: 'New value for The name of the font used to display the tab’s contents.'
      }
    },
    required: ['target_settings_set_required_string', 'value_required_text'],
    additionalProperties: false
  }
},
          {
  name: 'get_font_size_of_settings_set',
  description: 'Get The size of the font used to display the tab’s contents. of settings set',
  inputSchema: {
    type: 'object',
    properties: {
      target_settings_set_required_string: {
        type: 'string',
        description: 'The settings set object'
      }
    },
    required: ['target_settings_set_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'set_font_size_of_settings_set',
  description: 'Set The size of the font used to display the tab’s contents. of settings set',
  inputSchema: {
    type: 'object',
    properties: {
      target_settings_set_required_string: {
        type: 'string',
        description: 'The settings set object'
      },
      value_required_integer: {
        type: 'number',
        description: 'New value for The size of the font used to display the tab’s contents.'
      }
    },
    required: ['target_settings_set_required_string', 'value_required_integer'],
    additionalProperties: false
  }
},
          {
  name: 'get_font_antialiasing_of_settings_set',
  description: 'Get Whether the font used to display the tab’s contents is antialiased. of settings set',
  inputSchema: {
    type: 'object',
    properties: {
      target_settings_set_required_string: {
        type: 'string',
        description: 'The settings set object'
      }
    },
    required: ['target_settings_set_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'set_font_antialiasing_of_settings_set',
  description: 'Set Whether the font used to display the tab’s contents is antialiased. of settings set',
  inputSchema: {
    type: 'object',
    properties: {
      target_settings_set_required_string: {
        type: 'string',
        description: 'The settings set object'
      },
      value_required_boolean: {
        type: 'boolean',
        description: 'New value for Whether the font used to display the tab’s contents is antialiased.'
      }
    },
    required: ['target_settings_set_required_string', 'value_required_boolean'],
    additionalProperties: false
  }
},
          {
  name: 'get_clean_commands_of_settings_set',
  description: 'Get The processes which will be ignored when checking whether a tab can be closed without showing a prompt. of settings set',
  inputSchema: {
    type: 'object',
    properties: {
      target_settings_set_required_string: {
        type: 'string',
        description: 'The settings set object'
      }
    },
    required: ['target_settings_set_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'set_clean_commands_of_settings_set',
  description: 'Set The processes which will be ignored when checking whether a tab can be closed without showing a prompt. of settings set',
  inputSchema: {
    type: 'object',
    properties: {
      target_settings_set_required_string: {
        type: 'string',
        description: 'The settings set object'
      },
      value_required_text: {
        type: 'string',
        description: 'New value for The processes which will be ignored when checking whether a tab can be closed without showing a prompt.'
      }
    },
    required: ['target_settings_set_required_string', 'value_required_text'],
    additionalProperties: false
  }
},
          {
  name: 'get_title_displays_device_name_of_settings_set',
  description: 'Get Whether the title contains the device name. of settings set',
  inputSchema: {
    type: 'object',
    properties: {
      target_settings_set_required_string: {
        type: 'string',
        description: 'The settings set object'
      }
    },
    required: ['target_settings_set_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'set_title_displays_device_name_of_settings_set',
  description: 'Set Whether the title contains the device name. of settings set',
  inputSchema: {
    type: 'object',
    properties: {
      target_settings_set_required_string: {
        type: 'string',
        description: 'The settings set object'
      },
      value_required_boolean: {
        type: 'boolean',
        description: 'New value for Whether the title contains the device name.'
      }
    },
    required: ['target_settings_set_required_string', 'value_required_boolean'],
    additionalProperties: false
  }
},
          {
  name: 'get_title_displays_shell_path_of_settings_set',
  description: 'Get Whether the title contains the shell path. of settings set',
  inputSchema: {
    type: 'object',
    properties: {
      target_settings_set_required_string: {
        type: 'string',
        description: 'The settings set object'
      }
    },
    required: ['target_settings_set_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'set_title_displays_shell_path_of_settings_set',
  description: 'Set Whether the title contains the shell path. of settings set',
  inputSchema: {
    type: 'object',
    properties: {
      target_settings_set_required_string: {
        type: 'string',
        description: 'The settings set object'
      },
      value_required_boolean: {
        type: 'boolean',
        description: 'New value for Whether the title contains the shell path.'
      }
    },
    required: ['target_settings_set_required_string', 'value_required_boolean'],
    additionalProperties: false
  }
},
          {
  name: 'get_title_displays_window_size_of_settings_set',
  description: 'Get Whether the title contains the tab’s size, in rows and columns. of settings set',
  inputSchema: {
    type: 'object',
    properties: {
      target_settings_set_required_string: {
        type: 'string',
        description: 'The settings set object'
      }
    },
    required: ['target_settings_set_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'set_title_displays_window_size_of_settings_set',
  description: 'Set Whether the title contains the tab’s size, in rows and columns. of settings set',
  inputSchema: {
    type: 'object',
    properties: {
      target_settings_set_required_string: {
        type: 'string',
        description: 'The settings set object'
      },
      value_required_boolean: {
        type: 'boolean',
        description: 'New value for Whether the title contains the tab’s size, in rows and columns.'
      }
    },
    required: ['target_settings_set_required_string', 'value_required_boolean'],
    additionalProperties: false
  }
},
          {
  name: 'get_title_displays_settings_name_of_settings_set',
  description: 'Get Whether the title contains the settings name. of settings set',
  inputSchema: {
    type: 'object',
    properties: {
      target_settings_set_required_string: {
        type: 'string',
        description: 'The settings set object'
      }
    },
    required: ['target_settings_set_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'set_title_displays_settings_name_of_settings_set',
  description: 'Set Whether the title contains the settings name. of settings set',
  inputSchema: {
    type: 'object',
    properties: {
      target_settings_set_required_string: {
        type: 'string',
        description: 'The settings set object'
      },
      value_required_boolean: {
        type: 'boolean',
        description: 'New value for Whether the title contains the settings name.'
      }
    },
    required: ['target_settings_set_required_string', 'value_required_boolean'],
    additionalProperties: false
  }
},
          {
  name: 'get_title_displays_custom_title_of_settings_set',
  description: 'Get Whether the title contains a custom title. of settings set',
  inputSchema: {
    type: 'object',
    properties: {
      target_settings_set_required_string: {
        type: 'string',
        description: 'The settings set object'
      }
    },
    required: ['target_settings_set_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'set_title_displays_custom_title_of_settings_set',
  description: 'Set Whether the title contains a custom title. of settings set',
  inputSchema: {
    type: 'object',
    properties: {
      target_settings_set_required_string: {
        type: 'string',
        description: 'The settings set object'
      },
      value_required_boolean: {
        type: 'boolean',
        description: 'New value for Whether the title contains a custom title.'
      }
    },
    required: ['target_settings_set_required_string', 'value_required_boolean'],
    additionalProperties: false
  }
},
          {
  name: 'get_custom_title_of_settings_set',
  description: 'Get The tab’s custom title. of settings set',
  inputSchema: {
    type: 'object',
    properties: {
      target_settings_set_required_string: {
        type: 'string',
        description: 'The settings set object'
      }
    },
    required: ['target_settings_set_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'set_custom_title_of_settings_set',
  description: 'Set The tab’s custom title. of settings set',
  inputSchema: {
    type: 'object',
    properties: {
      target_settings_set_required_string: {
        type: 'string',
        description: 'The settings set object'
      },
      value_required_text: {
        type: 'string',
        description: 'New value for The tab’s custom title.'
      }
    },
    required: ['target_settings_set_required_string', 'value_required_text'],
    additionalProperties: false
  }
},
          {
  name: 'get_number_of_rows_of_tab_of_window',
  description: 'Get The number of rows displayed in the tab.',
  inputSchema: {
    type: 'object',
    properties: {
      target_tab_required_string: {
        type: 'string',
        description: 'The tab object'
      },
      target_window_required_string: {
        type: 'string',
        description: 'The window containing the tab'
      }
    },
    required: ['target_tab_required_string', 'target_window_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'set_number_of_rows_of_tab_of_window',
  description: 'Set The number of rows displayed in the tab.',
  inputSchema: {
    type: 'object',
    properties: {
      target_tab_required_string: {
        type: 'string',
        description: 'The tab object'
      },
      target_window_required_string: {
        type: 'string',
        description: 'The window containing the tab'
      },
      value_required_integer: {
        type: 'number',
        description: 'New value for The number of rows displayed in the tab.'
      }
    },
    required: ['target_tab_required_string', 'target_window_required_string', 'value_required_integer'],
    additionalProperties: false
  }
},
          {
  name: 'get_number_of_columns_of_tab_of_window',
  description: 'Get The number of columns displayed in the tab.',
  inputSchema: {
    type: 'object',
    properties: {
      target_tab_required_string: {
        type: 'string',
        description: 'The tab object'
      },
      target_window_required_string: {
        type: 'string',
        description: 'The window containing the tab'
      }
    },
    required: ['target_tab_required_string', 'target_window_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'set_number_of_columns_of_tab_of_window',
  description: 'Set The number of columns displayed in the tab.',
  inputSchema: {
    type: 'object',
    properties: {
      target_tab_required_string: {
        type: 'string',
        description: 'The tab object'
      },
      target_window_required_string: {
        type: 'string',
        description: 'The window containing the tab'
      },
      value_required_integer: {
        type: 'number',
        description: 'New value for The number of columns displayed in the tab.'
      }
    },
    required: ['target_tab_required_string', 'target_window_required_string', 'value_required_integer'],
    additionalProperties: false
  }
},
          {
  name: 'get_contents_of_tab_of_window',
  description: 'Get The currently visible contents of the tab.',
  inputSchema: {
    type: 'object',
    properties: {
      target_tab_required_string: {
        type: 'string',
        description: 'The tab object'
      },
      target_window_required_string: {
        type: 'string',
        description: 'The window containing the tab'
      }
    },
    required: ['target_tab_required_string', 'target_window_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'get_history_of_tab_of_window',
  description: 'Get The contents of the entire scrolling buffer of the tab.',
  inputSchema: {
    type: 'object',
    properties: {
      target_tab_required_string: {
        type: 'string',
        description: 'The tab object'
      },
      target_window_required_string: {
        type: 'string',
        description: 'The window containing the tab'
      }
    },
    required: ['target_tab_required_string', 'target_window_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'get_busy_of_tab_of_window',
  description: 'Get Whether the tab is busy running a process.',
  inputSchema: {
    type: 'object',
    properties: {
      target_tab_required_string: {
        type: 'string',
        description: 'The tab object'
      },
      target_window_required_string: {
        type: 'string',
        description: 'The window containing the tab'
      }
    },
    required: ['target_tab_required_string', 'target_window_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'get_processes_of_tab_of_window',
  description: 'Get The processes currently running in the tab.',
  inputSchema: {
    type: 'object',
    properties: {
      target_tab_required_string: {
        type: 'string',
        description: 'The tab object'
      },
      target_window_required_string: {
        type: 'string',
        description: 'The window containing the tab'
      }
    },
    required: ['target_tab_required_string', 'target_window_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'get_selected_of_tab_of_window',
  description: 'Get Whether the tab is selected.',
  inputSchema: {
    type: 'object',
    properties: {
      target_tab_required_string: {
        type: 'string',
        description: 'The tab object'
      },
      target_window_required_string: {
        type: 'string',
        description: 'The window containing the tab'
      }
    },
    required: ['target_tab_required_string', 'target_window_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'set_selected_of_tab_of_window',
  description: 'Set Whether the tab is selected.',
  inputSchema: {
    type: 'object',
    properties: {
      target_tab_required_string: {
        type: 'string',
        description: 'The tab object'
      },
      target_window_required_string: {
        type: 'string',
        description: 'The window containing the tab'
      },
      value_required_boolean: {
        type: 'boolean',
        description: 'New value for Whether the tab is selected.'
      }
    },
    required: ['target_tab_required_string', 'target_window_required_string', 'value_required_boolean'],
    additionalProperties: false
  }
},
          {
  name: 'get_title_displays_custom_title_of_tab_of_window',
  description: 'Get Whether the title contains a custom title. of tab',
  inputSchema: {
    type: 'object',
    properties: {
      target_tab_required_string: {
        type: 'string',
        description: 'The tab object'
      },
      target_window_required_string: {
        type: 'string',
        description: 'The window containing the tab'
      }
    },
    required: ['target_tab_required_string', 'target_window_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'set_title_displays_custom_title_of_tab_of_window',
  description: 'Set Whether the title contains a custom title. of tab',
  inputSchema: {
    type: 'object',
    properties: {
      target_tab_required_string: {
        type: 'string',
        description: 'The tab object'
      },
      target_window_required_string: {
        type: 'string',
        description: 'The window containing the tab'
      },
      value_required_boolean: {
        type: 'boolean',
        description: 'New value for Whether the title contains a custom title.'
      }
    },
    required: ['target_tab_required_string', 'target_window_required_string', 'value_required_boolean'],
    additionalProperties: false
  }
},
          {
  name: 'get_custom_title_of_tab_of_window',
  description: 'Get The tab’s custom title.',
  inputSchema: {
    type: 'object',
    properties: {
      target_tab_required_string: {
        type: 'string',
        description: 'The tab object'
      },
      target_window_required_string: {
        type: 'string',
        description: 'The window containing the tab'
      }
    },
    required: ['target_tab_required_string', 'target_window_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'set_custom_title_of_tab_of_window',
  description: 'Set The tab’s custom title.',
  inputSchema: {
    type: 'object',
    properties: {
      target_tab_required_string: {
        type: 'string',
        description: 'The tab object'
      },
      target_window_required_string: {
        type: 'string',
        description: 'The window containing the tab'
      },
      value_required_text: {
        type: 'string',
        description: 'New value for The tab’s custom title.'
      }
    },
    required: ['target_tab_required_string', 'target_window_required_string', 'value_required_text'],
    additionalProperties: false
  }
},
          {
  name: 'get_tty_of_tab_of_window',
  description: 'Get The tab’s TTY device.',
  inputSchema: {
    type: 'object',
    properties: {
      target_tab_required_string: {
        type: 'string',
        description: 'The tab object'
      },
      target_window_required_string: {
        type: 'string',
        description: 'The window containing the tab'
      }
    },
    required: ['target_tab_required_string', 'target_window_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'get_current_settings_of_tab_of_window',
  description: 'Get The set of settings which control the tab’s behavior and appearance.',
  inputSchema: {
    type: 'object',
    properties: {
      target_tab_required_string: {
        type: 'string',
        description: 'The tab object'
      },
      target_window_required_string: {
        type: 'string',
        description: 'The window containing the tab'
      }
    },
    required: ['target_tab_required_string', 'target_window_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'set_current_settings_of_tab_of_window',
  description: 'Set The set of settings which control the tab’s behavior and appearance.',
  inputSchema: {
    type: 'object',
    properties: {
      target_tab_required_string: {
        type: 'string',
        description: 'The tab object'
      },
      target_window_required_string: {
        type: 'string',
        description: 'The window containing the tab'
      },
      value_required_settings_set: {
        type: 'string',
        description: 'New value for The set of settings which control the tab’s behavior and appearance.'
      }
    },
    required: ['target_tab_required_string', 'target_window_required_string', 'value_required_settings_set'],
    additionalProperties: false
  }
},
          {
  name: 'get_cursor_color_of_tab_of_window',
  description: 'Get The cursor color for the tab.',
  inputSchema: {
    type: 'object',
    properties: {
      target_tab_required_string: {
        type: 'string',
        description: 'The tab object'
      },
      target_window_required_string: {
        type: 'string',
        description: 'The window containing the tab'
      }
    },
    required: ['target_tab_required_string', 'target_window_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'set_cursor_color_of_tab_of_window',
  description: 'Set The cursor color for the tab.',
  inputSchema: {
    type: 'object',
    properties: {
      target_tab_required_string: {
        type: 'string',
        description: 'The tab object'
      },
      target_window_required_string: {
        type: 'string',
        description: 'The window containing the tab'
      },
      value_required_color: {
        type: 'string',
        description: 'New value for The cursor color for the tab.'
      }
    },
    required: ['target_tab_required_string', 'target_window_required_string', 'value_required_color'],
    additionalProperties: false
  }
},
          {
  name: 'get_background_color_of_tab_of_window',
  description: 'Get The background color for the tab.',
  inputSchema: {
    type: 'object',
    properties: {
      target_tab_required_string: {
        type: 'string',
        description: 'The tab object'
      },
      target_window_required_string: {
        type: 'string',
        description: 'The window containing the tab'
      }
    },
    required: ['target_tab_required_string', 'target_window_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'set_background_color_of_tab_of_window',
  description: 'Set The background color for the tab.',
  inputSchema: {
    type: 'object',
    properties: {
      target_tab_required_string: {
        type: 'string',
        description: 'The tab object'
      },
      target_window_required_string: {
        type: 'string',
        description: 'The window containing the tab'
      },
      value_required_color: {
        type: 'string',
        description: 'New value for The background color for the tab.'
      }
    },
    required: ['target_tab_required_string', 'target_window_required_string', 'value_required_color'],
    additionalProperties: false
  }
},
          {
  name: 'get_normal_text_color_of_tab_of_window',
  description: 'Get The normal text color for the tab.',
  inputSchema: {
    type: 'object',
    properties: {
      target_tab_required_string: {
        type: 'string',
        description: 'The tab object'
      },
      target_window_required_string: {
        type: 'string',
        description: 'The window containing the tab'
      }
    },
    required: ['target_tab_required_string', 'target_window_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'set_normal_text_color_of_tab_of_window',
  description: 'Set The normal text color for the tab.',
  inputSchema: {
    type: 'object',
    properties: {
      target_tab_required_string: {
        type: 'string',
        description: 'The tab object'
      },
      target_window_required_string: {
        type: 'string',
        description: 'The window containing the tab'
      },
      value_required_color: {
        type: 'string',
        description: 'New value for The normal text color for the tab.'
      }
    },
    required: ['target_tab_required_string', 'target_window_required_string', 'value_required_color'],
    additionalProperties: false
  }
},
          {
  name: 'get_bold_text_color_of_tab_of_window',
  description: 'Get The bold text color for the tab.',
  inputSchema: {
    type: 'object',
    properties: {
      target_tab_required_string: {
        type: 'string',
        description: 'The tab object'
      },
      target_window_required_string: {
        type: 'string',
        description: 'The window containing the tab'
      }
    },
    required: ['target_tab_required_string', 'target_window_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'set_bold_text_color_of_tab_of_window',
  description: 'Set The bold text color for the tab.',
  inputSchema: {
    type: 'object',
    properties: {
      target_tab_required_string: {
        type: 'string',
        description: 'The tab object'
      },
      target_window_required_string: {
        type: 'string',
        description: 'The window containing the tab'
      },
      value_required_color: {
        type: 'string',
        description: 'New value for The bold text color for the tab.'
      }
    },
    required: ['target_tab_required_string', 'target_window_required_string', 'value_required_color'],
    additionalProperties: false
  }
},
          {
  name: 'get_clean_commands_of_tab_of_window',
  description: 'Get The processes which will be ignored when checking whether a tab can be closed without showing a prompt.',
  inputSchema: {
    type: 'object',
    properties: {
      target_tab_required_string: {
        type: 'string',
        description: 'The tab object'
      },
      target_window_required_string: {
        type: 'string',
        description: 'The window containing the tab'
      }
    },
    required: ['target_tab_required_string', 'target_window_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'set_clean_commands_of_tab_of_window',
  description: 'Set The processes which will be ignored when checking whether a tab can be closed without showing a prompt.',
  inputSchema: {
    type: 'object',
    properties: {
      target_tab_required_string: {
        type: 'string',
        description: 'The tab object'
      },
      target_window_required_string: {
        type: 'string',
        description: 'The window containing the tab'
      },
      value_required_text: {
        type: 'string',
        description: 'New value for The processes which will be ignored when checking whether a tab can be closed without showing a prompt.'
      }
    },
    required: ['target_tab_required_string', 'target_window_required_string', 'value_required_text'],
    additionalProperties: false
  }
},
          {
  name: 'get_title_displays_device_name_of_tab_of_window',
  description: 'Get Whether the title contains the device name. of tab',
  inputSchema: {
    type: 'object',
    properties: {
      target_tab_required_string: {
        type: 'string',
        description: 'The tab object'
      },
      target_window_required_string: {
        type: 'string',
        description: 'The window containing the tab'
      }
    },
    required: ['target_tab_required_string', 'target_window_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'set_title_displays_device_name_of_tab_of_window',
  description: 'Set Whether the title contains the device name. of tab',
  inputSchema: {
    type: 'object',
    properties: {
      target_tab_required_string: {
        type: 'string',
        description: 'The tab object'
      },
      target_window_required_string: {
        type: 'string',
        description: 'The window containing the tab'
      },
      value_required_boolean: {
        type: 'boolean',
        description: 'New value for Whether the title contains the device name.'
      }
    },
    required: ['target_tab_required_string', 'target_window_required_string', 'value_required_boolean'],
    additionalProperties: false
  }
},
          {
  name: 'get_title_displays_shell_path_of_tab_of_window',
  description: 'Get Whether the title contains the shell path. of tab',
  inputSchema: {
    type: 'object',
    properties: {
      target_tab_required_string: {
        type: 'string',
        description: 'The tab object'
      },
      target_window_required_string: {
        type: 'string',
        description: 'The window containing the tab'
      }
    },
    required: ['target_tab_required_string', 'target_window_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'set_title_displays_shell_path_of_tab_of_window',
  description: 'Set Whether the title contains the shell path. of tab',
  inputSchema: {
    type: 'object',
    properties: {
      target_tab_required_string: {
        type: 'string',
        description: 'The tab object'
      },
      target_window_required_string: {
        type: 'string',
        description: 'The window containing the tab'
      },
      value_required_boolean: {
        type: 'boolean',
        description: 'New value for Whether the title contains the shell path.'
      }
    },
    required: ['target_tab_required_string', 'target_window_required_string', 'value_required_boolean'],
    additionalProperties: false
  }
},
          {
  name: 'get_title_displays_window_size_of_tab_of_window',
  description: 'Get Whether the title contains the tab’s size, in rows and columns.',
  inputSchema: {
    type: 'object',
    properties: {
      target_tab_required_string: {
        type: 'string',
        description: 'The tab object'
      },
      target_window_required_string: {
        type: 'string',
        description: 'The window containing the tab'
      }
    },
    required: ['target_tab_required_string', 'target_window_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'set_title_displays_window_size_of_tab_of_window',
  description: 'Set Whether the title contains the tab’s size, in rows and columns.',
  inputSchema: {
    type: 'object',
    properties: {
      target_tab_required_string: {
        type: 'string',
        description: 'The tab object'
      },
      target_window_required_string: {
        type: 'string',
        description: 'The window containing the tab'
      },
      value_required_boolean: {
        type: 'boolean',
        description: 'New value for Whether the title contains the tab’s size, in rows and columns.'
      }
    },
    required: ['target_tab_required_string', 'target_window_required_string', 'value_required_boolean'],
    additionalProperties: false
  }
},
          {
  name: 'get_title_displays_file_name_of_tab_of_window',
  description: 'Get Whether the title contains the file name. of tab',
  inputSchema: {
    type: 'object',
    properties: {
      target_tab_required_string: {
        type: 'string',
        description: 'The tab object'
      },
      target_window_required_string: {
        type: 'string',
        description: 'The window containing the tab'
      }
    },
    required: ['target_tab_required_string', 'target_window_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'set_title_displays_file_name_of_tab_of_window',
  description: 'Set Whether the title contains the file name. of tab',
  inputSchema: {
    type: 'object',
    properties: {
      target_tab_required_string: {
        type: 'string',
        description: 'The tab object'
      },
      target_window_required_string: {
        type: 'string',
        description: 'The window containing the tab'
      },
      value_required_boolean: {
        type: 'boolean',
        description: 'New value for Whether the title contains the file name.'
      }
    },
    required: ['target_tab_required_string', 'target_window_required_string', 'value_required_boolean'],
    additionalProperties: false
  }
},
          {
  name: 'get_font_name_of_tab_of_window',
  description: 'Get The name of the font used to display the tab’s contents.',
  inputSchema: {
    type: 'object',
    properties: {
      target_tab_required_string: {
        type: 'string',
        description: 'The tab object'
      },
      target_window_required_string: {
        type: 'string',
        description: 'The window containing the tab'
      }
    },
    required: ['target_tab_required_string', 'target_window_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'set_font_name_of_tab_of_window',
  description: 'Set The name of the font used to display the tab’s contents.',
  inputSchema: {
    type: 'object',
    properties: {
      target_tab_required_string: {
        type: 'string',
        description: 'The tab object'
      },
      target_window_required_string: {
        type: 'string',
        description: 'The window containing the tab'
      },
      value_required_text: {
        type: 'string',
        description: 'New value for The name of the font used to display the tab’s contents.'
      }
    },
    required: ['target_tab_required_string', 'target_window_required_string', 'value_required_text'],
    additionalProperties: false
  }
},
          {
  name: 'get_font_size_of_tab_of_window',
  description: 'Get The size of the font used to display the tab’s contents.',
  inputSchema: {
    type: 'object',
    properties: {
      target_tab_required_string: {
        type: 'string',
        description: 'The tab object'
      },
      target_window_required_string: {
        type: 'string',
        description: 'The window containing the tab'
      }
    },
    required: ['target_tab_required_string', 'target_window_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'set_font_size_of_tab_of_window',
  description: 'Set The size of the font used to display the tab’s contents.',
  inputSchema: {
    type: 'object',
    properties: {
      target_tab_required_string: {
        type: 'string',
        description: 'The tab object'
      },
      target_window_required_string: {
        type: 'string',
        description: 'The window containing the tab'
      },
      value_required_integer: {
        type: 'number',
        description: 'New value for The size of the font used to display the tab’s contents.'
      }
    },
    required: ['target_tab_required_string', 'target_window_required_string', 'value_required_integer'],
    additionalProperties: false
  }
},
          {
  name: 'get_font_antialiasing_of_tab_of_window',
  description: 'Get Whether the font used to display the tab’s contents is antialiased.',
  inputSchema: {
    type: 'object',
    properties: {
      target_tab_required_string: {
        type: 'string',
        description: 'The tab object'
      },
      target_window_required_string: {
        type: 'string',
        description: 'The window containing the tab'
      }
    },
    required: ['target_tab_required_string', 'target_window_required_string'],
    additionalProperties: false
  }
},
          {
  name: 'set_font_antialiasing_of_tab_of_window',
  description: 'Set Whether the font used to display the tab’s contents is antialiased.',
  inputSchema: {
    type: 'object',
    properties: {
      target_tab_required_string: {
        type: 'string',
        description: 'The tab object'
      },
      target_window_required_string: {
        type: 'string',
        description: 'The window containing the tab'
      },
      value_required_boolean: {
        type: 'boolean',
        description: 'New value for Whether the font used to display the tab’s contents is antialiased.'
      }
    },
    required: ['target_tab_required_string', 'target_window_required_string', 'value_required_boolean'],
    additionalProperties: false
  }
},
        ]
      }
    };
    this.sendResponse(response);
  }

  async handleToolsCall(request) {
    console.error("Handling tools/call request for:", request.params.name);
    
    try {
      // Check app availability for all functions
      {
        const isTerminalAvailable = await checkTerminalAvailable();
        if (!isTerminalAvailable) {
          const errorResponse = {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  error: 'Application is not available or not running'
                }, null, 2)
              }]
            }
          };
          this.sendResponse(errorResponse);
          return;
        }
      }

      const { name, arguments: args } = request.params;
      let result;

      switch (name) {
        case 'get_name_of_application':
  result = await this.getNameOfApplication(args.target_application_required_string);
  break;
        case 'get_frontmost_of_application':
  result = await this.getFrontmostOfApplication(args.target_application_required_string);
  break;
        case 'get_version_of_application':
  result = await this.getVersionOfApplication(args.target_application_required_string);
  break;
        case 'get_name_of_document':
  result = await this.getNameOfDocument(args.target_document_required_string);
  break;
        case 'get_modified_of_document':
  result = await this.getModifiedOfDocument(args.target_document_required_string);
  break;
        case 'get_file_of_document':
  result = await this.getFileOfDocument(args.target_document_required_string);
  break;
        case 'get_name_of_window':
  result = await this.getNameOfWindow(args.target_window_required_string);
  break;
        case 'get_id_of_window':
  result = await this.getIdOfWindow(args.target_window_required_string);
  break;
        case 'get_index_of_window':
  result = await this.getIndexOfWindow(args.target_window_required_string);
  break;
        case 'set_index_of_window':
  result = await this.setIndexOfWindow(args.target_window_required_string, args.value_required_integer);
  break;
        case 'get_bounds_of_window':
  result = await this.getBoundsOfWindow(args.target_window_required_string);
  break;
        case 'set_bounds_of_window':
  result = await this.setBoundsOfWindow(args.target_window_required_string, args.value_required_rectangle);
  break;
        case 'get_closeable_of_window':
  result = await this.getCloseableOfWindow(args.target_window_required_string);
  break;
        case 'get_miniaturizable_of_window':
  result = await this.getMiniaturizableOfWindow(args.target_window_required_string);
  break;
        case 'get_miniaturized_of_window':
  result = await this.getMiniaturizedOfWindow(args.target_window_required_string);
  break;
        case 'set_miniaturized_of_window':
  result = await this.setMiniaturizedOfWindow(args.target_window_required_string, args.value_required_boolean);
  break;
        case 'get_resizable_of_window':
  result = await this.getResizableOfWindow(args.target_window_required_string);
  break;
        case 'get_visible_of_window':
  result = await this.getVisibleOfWindow(args.target_window_required_string);
  break;
        case 'set_visible_of_window':
  result = await this.setVisibleOfWindow(args.target_window_required_string, args.value_required_boolean);
  break;
        case 'get_zoomable_of_window':
  result = await this.getZoomableOfWindow(args.target_window_required_string);
  break;
        case 'get_zoomed_of_window':
  result = await this.getZoomedOfWindow(args.target_window_required_string);
  break;
        case 'set_zoomed_of_window':
  result = await this.setZoomedOfWindow(args.target_window_required_string, args.value_required_boolean);
  break;
        case 'get_document_of_window':
  result = await this.getDocumentOfWindow(args.target_window_required_string);
  break;
        case 'open':
  result = await this.open(args.direct_parameter_required_list_of_file);
  break;
        case 'close_for_document':
  result = await this.closeForDocument(args.target_document_required_string, args.saving_optional_save_options, args.saving_in_optional_file);
  break;
        case 'close_for_window':
  result = await this.closeForWindow(args.target_window_required_string, args.saving_optional_save_options, args.saving_in_optional_file);
  break;
        case 'save_for_document':
  result = await this.saveForDocument(args.target_document_required_string, args.inParam_optional_file);
  break;
        case 'save_for_window':
  result = await this.saveForWindow(args.target_window_required_string, args.inParam_optional_file);
  break;
        case 'print_file':
  result = await this.printFile(args.direct_parameter_required_list_of_file, args.with_properties_optional_print_settings, args.print_dialog_optional_boolean);
  break;
        case 'print_for_document':
  result = await this.printForDocument(args.target_document_required_string, args.with_properties_optional_print_settings, args.print_dialog_optional_boolean);
  break;
        case 'print_for_window':
  result = await this.printForWindow(args.target_window_required_string, args.with_properties_optional_print_settings, args.print_dialog_optional_boolean);
  break;
        case 'quit':
  result = await this.quit(args.saving_optional_save_options);
  break;
        case 'count_document':
  result = await this.countDocument();
  break;
        case 'count_tab_of_window':
  result = await this.countTabOfWindow(args.target_window_required_string);
  break;
        case 'count_settings_set':
  result = await this.countSettingsSet();
  break;
        case 'count_window':
  result = await this.countWindow();
  break;
        case 'delete':
  result = await this.delete(args.direct_parameter_required_specifier);
  break;
        case 'duplicate':
  result = await this.duplicate(args.direct_parameter_required_specifier, args.to_required_location_specifier, args.with_properties_optional_record);
  break;
        case 'exists':
  result = await this.exists(args.direct_parameter_required_specifier);
  break;
        case 'make_document':
  result = await this.makeDocument(args.at_optional_location_specifier, args.with_data_optional_any);
  break;
        case 'make_tab_of_window':
  result = await this.makeTabOfWindow(args.at_required_location_specifier_window, args.with_data_optional_any, args.with_properties_optional_text_font_name, args.with_properties_optional_color_cursor_color, args.with_properties_optional_boolean_title_displays_custom_title, args.with_properties_optional_text_custom_title, args.with_properties_optional_color_background_color, args.with_properties_optional_color_bold_text_color, args.with_properties_optional_boolean_title_displays_file_name, args.with_properties_optional_boolean_title_displays_device_name, args.with_properties_optional_integer_number_of_columns, args.with_properties_optional_integer_number_of_rows, args.with_properties_optional_boolean_title_displays_shell_path, args.with_properties_optional_color_normal_text_color, args.with_properties_optional_missing_value_clean_commands, args.with_properties_optional_boolean_selected, args.with_properties_optional_integer_font_size, args.with_properties_optional_boolean_font_antialiasing, args.with_properties_optional_settings_set_current_settings, args.with_properties_optional_boolean_title_displays_window_size);
  break;
        case 'make_settings_set':
  result = await this.makeSettingsSet(args.at_optional_location_specifier, args.with_data_optional_any, args.with_properties_optional_color_bold_text_color, args.with_properties_optional_integer_number_of_columns, args.with_properties_optional_boolean_title_displays_shell_path, args.with_properties_optional_boolean_title_displays_window_size, args.with_properties_optional_color_cursor_color, args.with_properties_optional_boolean_font_antialiasing, args.with_properties_optional_missing_value_clean_commands, args.with_properties_optional_color_background_color, args.with_properties_optional_text_font_name, args.with_properties_optional_integer_font_size, args.with_properties_optional_boolean_title_displays_settings_name, args.with_properties_optional_integer_number_of_rows, args.with_properties_optional_boolean_title_displays_custom_title, args.with_properties_optional_text_custom_title, args.with_properties_optional_boolean_title_displays_device_name, args.with_properties_optional_color_normal_text_color, args.with_properties_optional_text_name);
  break;
        case 'make_window':
  result = await this.makeWindow(args.at_optional_location_specifier, args.with_data_optional_any, args.with_properties_optional_integer_index, args.with_properties_optional_point_position, args.with_properties_optional_rectangle_frame, args.with_properties_optional_boolean_frontmost, args.with_properties_optional_boolean_zoomed, args.with_properties_optional_boolean_miniaturized, args.with_properties_optional_point_size, args.with_properties_optional_boolean_visible, args.with_properties_optional_point_origin, args.with_properties_optional_rectangle_bounds);
  break;
        case 'move':
  result = await this.move(args.direct_parameter_required_specifier, args.to_required_location_specifier);
  break;
        case 'get_frontmost_of_window':
  result = await this.getFrontmostOfWindow(args.target_window_required_string);
  break;
        case 'set_frontmost_of_window':
  result = await this.setFrontmostOfWindow(args.target_window_required_string, args.value_required_boolean);
  break;
        case 'get_position_of_window':
  result = await this.getPositionOfWindow(args.target_window_required_string);
  break;
        case 'set_position_of_window':
  result = await this.setPositionOfWindow(args.target_window_required_string, args.value_required_point);
  break;
        case 'get_origin_of_window':
  result = await this.getOriginOfWindow(args.target_window_required_string);
  break;
        case 'set_origin_of_window':
  result = await this.setOriginOfWindow(args.target_window_required_string, args.value_required_point);
  break;
        case 'get_size_of_window':
  result = await this.getSizeOfWindow(args.target_window_required_string);
  break;
        case 'set_size_of_window':
  result = await this.setSizeOfWindow(args.target_window_required_string, args.value_required_point);
  break;
        case 'get_frame_of_window':
  result = await this.getFrameOfWindow(args.target_window_required_string);
  break;
        case 'set_frame_of_window':
  result = await this.setFrameOfWindow(args.target_window_required_string, args.value_required_rectangle);
  break;
        case 'do_script':
  result = await this.doScript(args.direct_parameter_optional_text, args.with_command_optional_text, args.inParam_optional_tab);
  break;
        case 'get_url':
  result = await this.getUrl(args.direct_parameter_required_text);
  break;
        case 'get_default_settings_of_application':
  result = await this.getDefaultSettingsOfApplication(args.target_application_required_string);
  break;
        case 'set_default_settings_of_application':
  result = await this.setDefaultSettingsOfApplication(args.target_application_required_string, args.value_required_settings_set);
  break;
        case 'get_startup_settings_of_application':
  result = await this.getStartupSettingsOfApplication(args.target_application_required_string);
  break;
        case 'set_startup_settings_of_application':
  result = await this.setStartupSettingsOfApplication(args.target_application_required_string, args.value_required_settings_set);
  break;
        case 'get_id_of_settings_set':
  result = await this.getIdOfSettingsSet(args.target_settings_set_required_string);
  break;
        case 'get_name_of_settings_set':
  result = await this.getNameOfSettingsSet(args.target_settings_set_required_string);
  break;
        case 'set_name_of_settings_set':
  result = await this.setNameOfSettingsSet(args.target_settings_set_required_string, args.value_required_text);
  break;
        case 'get_number_of_rows_of_settings_set':
  result = await this.getNumberOfRowsOfSettingsSet(args.target_settings_set_required_string);
  break;
        case 'set_number_of_rows_of_settings_set':
  result = await this.setNumberOfRowsOfSettingsSet(args.target_settings_set_required_string, args.value_required_integer);
  break;
        case 'get_number_of_columns_of_settings_set':
  result = await this.getNumberOfColumnsOfSettingsSet(args.target_settings_set_required_string);
  break;
        case 'set_number_of_columns_of_settings_set':
  result = await this.setNumberOfColumnsOfSettingsSet(args.target_settings_set_required_string, args.value_required_integer);
  break;
        case 'get_cursor_color_of_settings_set':
  result = await this.getCursorColorOfSettingsSet(args.target_settings_set_required_string);
  break;
        case 'set_cursor_color_of_settings_set':
  result = await this.setCursorColorOfSettingsSet(args.target_settings_set_required_string, args.value_required_color);
  break;
        case 'get_background_color_of_settings_set':
  result = await this.getBackgroundColorOfSettingsSet(args.target_settings_set_required_string);
  break;
        case 'set_background_color_of_settings_set':
  result = await this.setBackgroundColorOfSettingsSet(args.target_settings_set_required_string, args.value_required_color);
  break;
        case 'get_normal_text_color_of_settings_set':
  result = await this.getNormalTextColorOfSettingsSet(args.target_settings_set_required_string);
  break;
        case 'set_normal_text_color_of_settings_set':
  result = await this.setNormalTextColorOfSettingsSet(args.target_settings_set_required_string, args.value_required_color);
  break;
        case 'get_bold_text_color_of_settings_set':
  result = await this.getBoldTextColorOfSettingsSet(args.target_settings_set_required_string);
  break;
        case 'set_bold_text_color_of_settings_set':
  result = await this.setBoldTextColorOfSettingsSet(args.target_settings_set_required_string, args.value_required_color);
  break;
        case 'get_font_name_of_settings_set':
  result = await this.getFontNameOfSettingsSet(args.target_settings_set_required_string);
  break;
        case 'set_font_name_of_settings_set':
  result = await this.setFontNameOfSettingsSet(args.target_settings_set_required_string, args.value_required_text);
  break;
        case 'get_font_size_of_settings_set':
  result = await this.getFontSizeOfSettingsSet(args.target_settings_set_required_string);
  break;
        case 'set_font_size_of_settings_set':
  result = await this.setFontSizeOfSettingsSet(args.target_settings_set_required_string, args.value_required_integer);
  break;
        case 'get_font_antialiasing_of_settings_set':
  result = await this.getFontAntialiasingOfSettingsSet(args.target_settings_set_required_string);
  break;
        case 'set_font_antialiasing_of_settings_set':
  result = await this.setFontAntialiasingOfSettingsSet(args.target_settings_set_required_string, args.value_required_boolean);
  break;
        case 'get_clean_commands_of_settings_set':
  result = await this.getCleanCommandsOfSettingsSet(args.target_settings_set_required_string);
  break;
        case 'set_clean_commands_of_settings_set':
  result = await this.setCleanCommandsOfSettingsSet(args.target_settings_set_required_string, args.value_required_text);
  break;
        case 'get_title_displays_device_name_of_settings_set':
  result = await this.getTitleDisplaysDeviceNameOfSettingsSet(args.target_settings_set_required_string);
  break;
        case 'set_title_displays_device_name_of_settings_set':
  result = await this.setTitleDisplaysDeviceNameOfSettingsSet(args.target_settings_set_required_string, args.value_required_boolean);
  break;
        case 'get_title_displays_shell_path_of_settings_set':
  result = await this.getTitleDisplaysShellPathOfSettingsSet(args.target_settings_set_required_string);
  break;
        case 'set_title_displays_shell_path_of_settings_set':
  result = await this.setTitleDisplaysShellPathOfSettingsSet(args.target_settings_set_required_string, args.value_required_boolean);
  break;
        case 'get_title_displays_window_size_of_settings_set':
  result = await this.getTitleDisplaysWindowSizeOfSettingsSet(args.target_settings_set_required_string);
  break;
        case 'set_title_displays_window_size_of_settings_set':
  result = await this.setTitleDisplaysWindowSizeOfSettingsSet(args.target_settings_set_required_string, args.value_required_boolean);
  break;
        case 'get_title_displays_settings_name_of_settings_set':
  result = await this.getTitleDisplaysSettingsNameOfSettingsSet(args.target_settings_set_required_string);
  break;
        case 'set_title_displays_settings_name_of_settings_set':
  result = await this.setTitleDisplaysSettingsNameOfSettingsSet(args.target_settings_set_required_string, args.value_required_boolean);
  break;
        case 'get_title_displays_custom_title_of_settings_set':
  result = await this.getTitleDisplaysCustomTitleOfSettingsSet(args.target_settings_set_required_string);
  break;
        case 'set_title_displays_custom_title_of_settings_set':
  result = await this.setTitleDisplaysCustomTitleOfSettingsSet(args.target_settings_set_required_string, args.value_required_boolean);
  break;
        case 'get_custom_title_of_settings_set':
  result = await this.getCustomTitleOfSettingsSet(args.target_settings_set_required_string);
  break;
        case 'set_custom_title_of_settings_set':
  result = await this.setCustomTitleOfSettingsSet(args.target_settings_set_required_string, args.value_required_text);
  break;
        case 'get_number_of_rows_of_tab_of_window':
  result = await this.getNumberOfRowsOfTabOfWindow(args.target_tab_required_string, args.target_window_required_string);
  break;
        case 'set_number_of_rows_of_tab_of_window':
  result = await this.setNumberOfRowsOfTabOfWindow(args.target_tab_required_string, args.target_window_required_string, args.value_required_integer);
  break;
        case 'get_number_of_columns_of_tab_of_window':
  result = await this.getNumberOfColumnsOfTabOfWindow(args.target_tab_required_string, args.target_window_required_string);
  break;
        case 'set_number_of_columns_of_tab_of_window':
  result = await this.setNumberOfColumnsOfTabOfWindow(args.target_tab_required_string, args.target_window_required_string, args.value_required_integer);
  break;
        case 'get_contents_of_tab_of_window':
  result = await this.getContentsOfTabOfWindow(args.target_tab_required_string, args.target_window_required_string);
  break;
        case 'get_history_of_tab_of_window':
  result = await this.getHistoryOfTabOfWindow(args.target_tab_required_string, args.target_window_required_string);
  break;
        case 'get_busy_of_tab_of_window':
  result = await this.getBusyOfTabOfWindow(args.target_tab_required_string, args.target_window_required_string);
  break;
        case 'get_processes_of_tab_of_window':
  result = await this.getProcessesOfTabOfWindow(args.target_tab_required_string, args.target_window_required_string);
  break;
        case 'get_selected_of_tab_of_window':
  result = await this.getSelectedOfTabOfWindow(args.target_tab_required_string, args.target_window_required_string);
  break;
        case 'set_selected_of_tab_of_window':
  result = await this.setSelectedOfTabOfWindow(args.target_tab_required_string, args.target_window_required_string, args.value_required_boolean);
  break;
        case 'get_title_displays_custom_title_of_tab_of_window':
  result = await this.getTitleDisplaysCustomTitleOfTabOfWindow(args.target_tab_required_string, args.target_window_required_string);
  break;
        case 'set_title_displays_custom_title_of_tab_of_window':
  result = await this.setTitleDisplaysCustomTitleOfTabOfWindow(args.target_tab_required_string, args.target_window_required_string, args.value_required_boolean);
  break;
        case 'get_custom_title_of_tab_of_window':
  result = await this.getCustomTitleOfTabOfWindow(args.target_tab_required_string, args.target_window_required_string);
  break;
        case 'set_custom_title_of_tab_of_window':
  result = await this.setCustomTitleOfTabOfWindow(args.target_tab_required_string, args.target_window_required_string, args.value_required_text);
  break;
        case 'get_tty_of_tab_of_window':
  result = await this.getTtyOfTabOfWindow(args.target_tab_required_string, args.target_window_required_string);
  break;
        case 'get_current_settings_of_tab_of_window':
  result = await this.getCurrentSettingsOfTabOfWindow(args.target_tab_required_string, args.target_window_required_string);
  break;
        case 'set_current_settings_of_tab_of_window':
  result = await this.setCurrentSettingsOfTabOfWindow(args.target_tab_required_string, args.target_window_required_string, args.value_required_settings_set);
  break;
        case 'get_cursor_color_of_tab_of_window':
  result = await this.getCursorColorOfTabOfWindow(args.target_tab_required_string, args.target_window_required_string);
  break;
        case 'set_cursor_color_of_tab_of_window':
  result = await this.setCursorColorOfTabOfWindow(args.target_tab_required_string, args.target_window_required_string, args.value_required_color);
  break;
        case 'get_background_color_of_tab_of_window':
  result = await this.getBackgroundColorOfTabOfWindow(args.target_tab_required_string, args.target_window_required_string);
  break;
        case 'set_background_color_of_tab_of_window':
  result = await this.setBackgroundColorOfTabOfWindow(args.target_tab_required_string, args.target_window_required_string, args.value_required_color);
  break;
        case 'get_normal_text_color_of_tab_of_window':
  result = await this.getNormalTextColorOfTabOfWindow(args.target_tab_required_string, args.target_window_required_string);
  break;
        case 'set_normal_text_color_of_tab_of_window':
  result = await this.setNormalTextColorOfTabOfWindow(args.target_tab_required_string, args.target_window_required_string, args.value_required_color);
  break;
        case 'get_bold_text_color_of_tab_of_window':
  result = await this.getBoldTextColorOfTabOfWindow(args.target_tab_required_string, args.target_window_required_string);
  break;
        case 'set_bold_text_color_of_tab_of_window':
  result = await this.setBoldTextColorOfTabOfWindow(args.target_tab_required_string, args.target_window_required_string, args.value_required_color);
  break;
        case 'get_clean_commands_of_tab_of_window':
  result = await this.getCleanCommandsOfTabOfWindow(args.target_tab_required_string, args.target_window_required_string);
  break;
        case 'set_clean_commands_of_tab_of_window':
  result = await this.setCleanCommandsOfTabOfWindow(args.target_tab_required_string, args.target_window_required_string, args.value_required_text);
  break;
        case 'get_title_displays_device_name_of_tab_of_window':
  result = await this.getTitleDisplaysDeviceNameOfTabOfWindow(args.target_tab_required_string, args.target_window_required_string);
  break;
        case 'set_title_displays_device_name_of_tab_of_window':
  result = await this.setTitleDisplaysDeviceNameOfTabOfWindow(args.target_tab_required_string, args.target_window_required_string, args.value_required_boolean);
  break;
        case 'get_title_displays_shell_path_of_tab_of_window':
  result = await this.getTitleDisplaysShellPathOfTabOfWindow(args.target_tab_required_string, args.target_window_required_string);
  break;
        case 'set_title_displays_shell_path_of_tab_of_window':
  result = await this.setTitleDisplaysShellPathOfTabOfWindow(args.target_tab_required_string, args.target_window_required_string, args.value_required_boolean);
  break;
        case 'get_title_displays_window_size_of_tab_of_window':
  result = await this.getTitleDisplaysWindowSizeOfTabOfWindow(args.target_tab_required_string, args.target_window_required_string);
  break;
        case 'set_title_displays_window_size_of_tab_of_window':
  result = await this.setTitleDisplaysWindowSizeOfTabOfWindow(args.target_tab_required_string, args.target_window_required_string, args.value_required_boolean);
  break;
        case 'get_title_displays_file_name_of_tab_of_window':
  result = await this.getTitleDisplaysFileNameOfTabOfWindow(args.target_tab_required_string, args.target_window_required_string);
  break;
        case 'set_title_displays_file_name_of_tab_of_window':
  result = await this.setTitleDisplaysFileNameOfTabOfWindow(args.target_tab_required_string, args.target_window_required_string, args.value_required_boolean);
  break;
        case 'get_font_name_of_tab_of_window':
  result = await this.getFontNameOfTabOfWindow(args.target_tab_required_string, args.target_window_required_string);
  break;
        case 'set_font_name_of_tab_of_window':
  result = await this.setFontNameOfTabOfWindow(args.target_tab_required_string, args.target_window_required_string, args.value_required_text);
  break;
        case 'get_font_size_of_tab_of_window':
  result = await this.getFontSizeOfTabOfWindow(args.target_tab_required_string, args.target_window_required_string);
  break;
        case 'set_font_size_of_tab_of_window':
  result = await this.setFontSizeOfTabOfWindow(args.target_tab_required_string, args.target_window_required_string, args.value_required_integer);
  break;
        case 'get_font_antialiasing_of_tab_of_window':
  result = await this.getFontAntialiasingOfTabOfWindow(args.target_tab_required_string, args.target_window_required_string);
  break;
        case 'set_font_antialiasing_of_tab_of_window':
  result = await this.setFontAntialiasingOfTabOfWindow(args.target_tab_required_string, args.target_window_required_string, args.value_required_boolean);
  break;
        default:
          throw new Error(`Unknown tool: ${name}`);
      }

      const response = {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2)
          }]
        }
      };
      this.sendResponse(response);

    } catch (error) {
      console.error(`Error in tool '${request.params.name}':`, error);
      const errorResponse = {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error.message,
              tool: request.params.name,
              args: request.params.arguments
            }, null, 2)
          }]
        }
      };
      this.sendResponse(errorResponse);
    }
  }

  async getNameOfApplication(target_application_required_string) {
    if (!target_application_required_string || typeof target_application_required_string !== "string") {
      throw new Error("target_application_required_string is required and must be a string");
    }

    const escapedApplication = escapeForAppleScript(target_application_required_string);

    const script = `
      tell application "Terminal"
        tell ${escapedApplication}
          return name of it
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      value: result,
      script: script,
      application: target_application_required_string
    };
  }

  async getFrontmostOfApplication(target_application_required_string) {
    if (!target_application_required_string || typeof target_application_required_string !== "string") {
      throw new Error("target_application_required_string is required and must be a string");
    }

    const escapedApplication = escapeForAppleScript(target_application_required_string);

    const script = `
      tell application "Terminal"
        tell ${escapedApplication}
          return frontmost of it
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      value: result,
      script: script,
      application: target_application_required_string
    };
  }

  async getVersionOfApplication(target_application_required_string) {
    if (!target_application_required_string || typeof target_application_required_string !== "string") {
      throw new Error("target_application_required_string is required and must be a string");
    }

    const escapedApplication = escapeForAppleScript(target_application_required_string);

    const script = `
      tell application "Terminal"
        tell ${escapedApplication}
          return version of it
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      value: result,
      script: script,
      application: target_application_required_string
    };
  }

  async getNameOfDocument(target_document_required_string) {
    if (!target_document_required_string || typeof target_document_required_string !== "string") {
      throw new Error("target_document_required_string is required and must be a string");
    }

    const escapedDocument = escapeForAppleScript(target_document_required_string);

    const script = `
      tell application "Terminal"
        tell ${escapedDocument}
          return name of it
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      value: result,
      script: script,
      document: target_document_required_string
    };
  }

  async getModifiedOfDocument(target_document_required_string) {
    if (!target_document_required_string || typeof target_document_required_string !== "string") {
      throw new Error("target_document_required_string is required and must be a string");
    }

    const escapedDocument = escapeForAppleScript(target_document_required_string);

    const script = `
      tell application "Terminal"
        tell ${escapedDocument}
          return modified of it
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      value: result,
      script: script,
      document: target_document_required_string
    };
  }

  async getFileOfDocument(target_document_required_string) {
    if (!target_document_required_string || typeof target_document_required_string !== "string") {
      throw new Error("target_document_required_string is required and must be a string");
    }

    const escapedDocument = escapeForAppleScript(target_document_required_string);

    const script = `
      tell application "Terminal"
        tell ${escapedDocument}
          return file of it
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      value: result,
      script: script,
      document: target_document_required_string
    };
  }

  async getNameOfWindow(target_window_required_string) {
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }

    const escapedWindow = escapeForAppleScript(target_window_required_string);

    const script = `
      tell application "Terminal"
        tell ${escapedWindow}
          return name of it
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      value: result,
      script: script,
      window: target_window_required_string
    };
  }

  async getIdOfWindow(target_window_required_string) {
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }

    const escapedWindow = escapeForAppleScript(target_window_required_string);

    const script = `
      tell application "Terminal"
        tell ${escapedWindow}
          return id of it
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      value: result,
      script: script,
      window: target_window_required_string
    };
  }

  async getIndexOfWindow(target_window_required_string) {
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }

    const escapedWindow = escapeForAppleScript(target_window_required_string);

    const script = `
      tell application "Terminal"
        tell ${escapedWindow}
          return index of it
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      value: result,
      script: script,
      window: target_window_required_string
    };
  }

  async setIndexOfWindow(target_window_required_string, value_required_integer) {
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }
    if (value_required_integer === undefined || value_required_integer === null) {
      throw new Error("value_required_integer is required");
    }

    const castedWindow = castAndEscape(target_window_required_string, 'string');
    const castedValue = castAndEscape(value_required_integer, 'integer');
    // Determine value format for AppleScript
    let valueForScript;
    if (typeof castedValue === 'string' && !castedValue.startsWith('{') && !castedValue.startsWith('date')) {
      valueForScript = `"${castedValue}"`; // Wrap strings in quotes
    } else {
      valueForScript = castedValue; // Use as-is for numbers, booleans, lists, records
    }

    const script = `
      tell application "Terminal"
        tell ${castedWindow}
          set index of it to ${valueForScript}
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      message: "Property set successfully",
      value: value_required_integer,
      script: script,
      window: target_window_required_string
    };
  }

  async getBoundsOfWindow(target_window_required_string) {
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }

    const escapedWindow = escapeForAppleScript(target_window_required_string);

    const script = `
      tell application "Terminal"
        tell ${escapedWindow}
          return bounds of it
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      value: result,
      script: script,
      window: target_window_required_string
    };
  }

  async setBoundsOfWindow(target_window_required_string, value_required_rectangle) {
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }
    if (value_required_rectangle === undefined || value_required_rectangle === null) {
      throw new Error("value_required_rectangle is required");
    }

    const castedWindow = castAndEscape(target_window_required_string, 'string');
    const castedValue = castAndEscape(value_required_rectangle, 'rectangle');
    // Determine value format for AppleScript
    let valueForScript;
    if (typeof castedValue === 'string' && !castedValue.startsWith('{') && !castedValue.startsWith('date')) {
      valueForScript = `"${castedValue}"`; // Wrap strings in quotes
    } else {
      valueForScript = castedValue; // Use as-is for numbers, booleans, lists, records
    }

    const script = `
      tell application "Terminal"
        tell ${castedWindow}
          set bounds of it to ${valueForScript}
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      message: "Property set successfully",
      value: value_required_rectangle,
      script: script,
      window: target_window_required_string
    };
  }

  async getCloseableOfWindow(target_window_required_string) {
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }

    const escapedWindow = escapeForAppleScript(target_window_required_string);

    const script = `
      tell application "Terminal"
        tell ${escapedWindow}
          return closeable of it
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      value: result,
      script: script,
      window: target_window_required_string
    };
  }

  async getMiniaturizableOfWindow(target_window_required_string) {
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }

    const escapedWindow = escapeForAppleScript(target_window_required_string);

    const script = `
      tell application "Terminal"
        tell ${escapedWindow}
          return miniaturizable of it
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      value: result,
      script: script,
      window: target_window_required_string
    };
  }

  async getMiniaturizedOfWindow(target_window_required_string) {
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }

    const escapedWindow = escapeForAppleScript(target_window_required_string);

    const script = `
      tell application "Terminal"
        tell ${escapedWindow}
          return miniaturized of it
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      value: result,
      script: script,
      window: target_window_required_string
    };
  }

  async setMiniaturizedOfWindow(target_window_required_string, value_required_boolean) {
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }
    if (value_required_boolean === undefined || value_required_boolean === null) {
      throw new Error("value_required_boolean is required");
    }

    const castedWindow = castAndEscape(target_window_required_string, 'string');
    const castedValue = castAndEscape(value_required_boolean, 'boolean');
    // Determine value format for AppleScript
    let valueForScript;
    if (typeof castedValue === 'string' && !castedValue.startsWith('{') && !castedValue.startsWith('date')) {
      valueForScript = `"${castedValue}"`; // Wrap strings in quotes
    } else {
      valueForScript = castedValue; // Use as-is for numbers, booleans, lists, records
    }

    const script = `
      tell application "Terminal"
        tell ${castedWindow}
          set miniaturized of it to ${valueForScript}
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      message: "Property set successfully",
      value: value_required_boolean,
      script: script,
      window: target_window_required_string
    };
  }

  async getResizableOfWindow(target_window_required_string) {
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }

    const escapedWindow = escapeForAppleScript(target_window_required_string);

    const script = `
      tell application "Terminal"
        tell ${escapedWindow}
          return resizable of it
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      value: result,
      script: script,
      window: target_window_required_string
    };
  }

  async getVisibleOfWindow(target_window_required_string) {
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }

    const escapedWindow = escapeForAppleScript(target_window_required_string);

    const script = `
      tell application "Terminal"
        tell ${escapedWindow}
          return visible of it
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      value: result,
      script: script,
      window: target_window_required_string
    };
  }

  async setVisibleOfWindow(target_window_required_string, value_required_boolean) {
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }
    if (value_required_boolean === undefined || value_required_boolean === null) {
      throw new Error("value_required_boolean is required");
    }

    const castedWindow = castAndEscape(target_window_required_string, 'string');
    const castedValue = castAndEscape(value_required_boolean, 'boolean');
    // Determine value format for AppleScript
    let valueForScript;
    if (typeof castedValue === 'string' && !castedValue.startsWith('{') && !castedValue.startsWith('date')) {
      valueForScript = `"${castedValue}"`; // Wrap strings in quotes
    } else {
      valueForScript = castedValue; // Use as-is for numbers, booleans, lists, records
    }

    const script = `
      tell application "Terminal"
        tell ${castedWindow}
          set visible of it to ${valueForScript}
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      message: "Property set successfully",
      value: value_required_boolean,
      script: script,
      window: target_window_required_string
    };
  }

  async getZoomableOfWindow(target_window_required_string) {
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }

    const escapedWindow = escapeForAppleScript(target_window_required_string);

    const script = `
      tell application "Terminal"
        tell ${escapedWindow}
          return zoomable of it
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      value: result,
      script: script,
      window: target_window_required_string
    };
  }

  async getZoomedOfWindow(target_window_required_string) {
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }

    const escapedWindow = escapeForAppleScript(target_window_required_string);

    const script = `
      tell application "Terminal"
        tell ${escapedWindow}
          return zoomed of it
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      value: result,
      script: script,
      window: target_window_required_string
    };
  }

  async setZoomedOfWindow(target_window_required_string, value_required_boolean) {
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }
    if (value_required_boolean === undefined || value_required_boolean === null) {
      throw new Error("value_required_boolean is required");
    }

    const castedWindow = castAndEscape(target_window_required_string, 'string');
    const castedValue = castAndEscape(value_required_boolean, 'boolean');
    // Determine value format for AppleScript
    let valueForScript;
    if (typeof castedValue === 'string' && !castedValue.startsWith('{') && !castedValue.startsWith('date')) {
      valueForScript = `"${castedValue}"`; // Wrap strings in quotes
    } else {
      valueForScript = castedValue; // Use as-is for numbers, booleans, lists, records
    }

    const script = `
      tell application "Terminal"
        tell ${castedWindow}
          set zoomed of it to ${valueForScript}
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      message: "Property set successfully",
      value: value_required_boolean,
      script: script,
      window: target_window_required_string
    };
  }

  async getDocumentOfWindow(target_window_required_string) {
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }

    const escapedWindow = escapeForAppleScript(target_window_required_string);

    const script = `
      tell application "Terminal"
        tell ${escapedWindow}
          return document of it
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      value: result,
      script: script,
      window: target_window_required_string
    };
  }

  async open(direct_parameter_required_list_of_file) {
    if (direct_parameter_required_list_of_file === undefined || direct_parameter_required_list_of_file === null) {
      throw new Error("direct_parameter_required_list_of_file is required");
    }

    const castedDirect_parameter = direct_parameter_required_list_of_file ? castAndEscape(direct_parameter_required_list_of_file) : null;

    const script = `
      tell application "Terminal"
        open ${castedDirect_parameter}
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      message: result,
      script: script,
      direct_parameter: direct_parameter_required_list_of_file || null
    };
  }

  async closeForDocument(target_document_required_string, saving_optional_save_options, saving_in_optional_file) {
    if (!target_document_required_string || typeof target_document_required_string !== "string") {
      throw new Error("target_document_required_string is required and must be a string");
    }

    const castedDocument = castAndEscape(target_document_required_string);
    const castedSaving = saving_optional_save_options ? castAndEscape(saving_optional_save_options) : null;
    const valueForScriptSaving = castedSaving && typeof castedSaving === 'string' && !castedSaving.startsWith('{') && !castedSaving.startsWith('date') ? `"${castedSaving.replace(/"/g, "'")}"` : castedSaving;
    const castedSaving_in = saving_in_optional_file ? castAndEscape(saving_in_optional_file) : null;
    const valueForScriptSaving_in = castedSaving_in && typeof castedSaving_in === 'string' && !castedSaving_in.startsWith('{') && !castedSaving_in.startsWith('date') ? `"${castedSaving_in.replace(/"/g, "'")}"` : castedSaving_in;

    // Helper function to build properties record from individual property parameters
    function buildPropertiesRecord(propertyParams) {
      const definedProps = propertyParams.filter(p => p.value !== undefined && p.value !== null && p.value !== '');
      if (definedProps.length === 0) return '';
      const propStrings = definedProps.map(p => {
        const castedValue = castAndEscape(p.value, p.type || null);
        // For strings that got escaped, wrap in quotes and replace inner quotes
        if (typeof castedValue === 'string' && !castedValue.startsWith('{') && !castedValue.startsWith('date')) {
          return `${p.prop}:"${castedValue.replace(/"/g, "'")}"`;
        }
        // For numbers, booleans, lists, records, dates - no quotes
        return `${p.prop}:${castedValue}`;
      });
      return ` with properties {${propStrings.join(', ')}}`;
    }

    const script = `
      tell application "Terminal"
        tell ${castedDocument}
          close it${saving_optional_save_options ? ' saving ' + valueForScriptSaving : ''}${saving_in_optional_file ? ' saving in ' + valueForScriptSaving_in : ''}
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      message: result,
      script: script,
      document: target_document_required_string,
      saving: saving_optional_save_options || null,
      saving_in: saving_in_optional_file || null
    };
  }

  async closeForWindow(target_window_required_string, saving_optional_save_options, saving_in_optional_file) {
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }

    const castedWindow = castAndEscape(target_window_required_string);
    const castedSaving = saving_optional_save_options ? castAndEscape(saving_optional_save_options) : null;
    const valueForScriptSaving = castedSaving && typeof castedSaving === 'string' && !castedSaving.startsWith('{') && !castedSaving.startsWith('date') ? `"${castedSaving.replace(/"/g, "'")}"` : castedSaving;
    const castedSaving_in = saving_in_optional_file ? castAndEscape(saving_in_optional_file) : null;
    const valueForScriptSaving_in = castedSaving_in && typeof castedSaving_in === 'string' && !castedSaving_in.startsWith('{') && !castedSaving_in.startsWith('date') ? `"${castedSaving_in.replace(/"/g, "'")}"` : castedSaving_in;

    // Helper function to build properties record from individual property parameters
    function buildPropertiesRecord(propertyParams) {
      const definedProps = propertyParams.filter(p => p.value !== undefined && p.value !== null && p.value !== '');
      if (definedProps.length === 0) return '';
      const propStrings = definedProps.map(p => {
        const castedValue = castAndEscape(p.value, p.type || null);
        // For strings that got escaped, wrap in quotes and replace inner quotes
        if (typeof castedValue === 'string' && !castedValue.startsWith('{') && !castedValue.startsWith('date')) {
          return `${p.prop}:"${castedValue.replace(/"/g, "'")}"`;
        }
        // For numbers, booleans, lists, records, dates - no quotes
        return `${p.prop}:${castedValue}`;
      });
      return ` with properties {${propStrings.join(', ')}}`;
    }

    const script = `
      tell application "Terminal"
        tell ${castedWindow}
          close it${saving_optional_save_options ? ' saving ' + valueForScriptSaving : ''}${saving_in_optional_file ? ' saving in ' + valueForScriptSaving_in : ''}
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      message: result,
      script: script,
      window: target_window_required_string,
      saving: saving_optional_save_options || null,
      saving_in: saving_in_optional_file || null
    };
  }

  async saveForDocument(target_document_required_string, inParam_optional_file) {
    if (!target_document_required_string || typeof target_document_required_string !== "string") {
      throw new Error("target_document_required_string is required and must be a string");
    }

    const castedDocument = castAndEscape(target_document_required_string);
    const castedIn = inParam_optional_file ? castAndEscape(inParam_optional_file) : null;
    const valueForScriptIn = castedIn && typeof castedIn === 'string' && !castedIn.startsWith('{') && !castedIn.startsWith('date') ? `"${castedIn.replace(/"/g, "'")}"` : castedIn;

    // Helper function to build properties record from individual property parameters
    function buildPropertiesRecord(propertyParams) {
      const definedProps = propertyParams.filter(p => p.value !== undefined && p.value !== null && p.value !== '');
      if (definedProps.length === 0) return '';
      const propStrings = definedProps.map(p => {
        const castedValue = castAndEscape(p.value, p.type || null);
        // For strings that got escaped, wrap in quotes and replace inner quotes
        if (typeof castedValue === 'string' && !castedValue.startsWith('{') && !castedValue.startsWith('date')) {
          return `${p.prop}:"${castedValue.replace(/"/g, "'")}"`;
        }
        // For numbers, booleans, lists, records, dates - no quotes
        return `${p.prop}:${castedValue}`;
      });
      return ` with properties {${propStrings.join(', ')}}`;
    }

    const script = `
      tell application "Terminal"
        tell ${castedDocument}
          save it${inParam_optional_file ? ' in ' + valueForScriptIn : ''}
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      message: result,
      script: script,
      document: target_document_required_string,
      in: inParam_optional_file || null
    };
  }

  async saveForWindow(target_window_required_string, inParam_optional_file) {
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }

    const castedWindow = castAndEscape(target_window_required_string);
    const castedIn = inParam_optional_file ? castAndEscape(inParam_optional_file) : null;
    const valueForScriptIn = castedIn && typeof castedIn === 'string' && !castedIn.startsWith('{') && !castedIn.startsWith('date') ? `"${castedIn.replace(/"/g, "'")}"` : castedIn;

    // Helper function to build properties record from individual property parameters
    function buildPropertiesRecord(propertyParams) {
      const definedProps = propertyParams.filter(p => p.value !== undefined && p.value !== null && p.value !== '');
      if (definedProps.length === 0) return '';
      const propStrings = definedProps.map(p => {
        const castedValue = castAndEscape(p.value, p.type || null);
        // For strings that got escaped, wrap in quotes and replace inner quotes
        if (typeof castedValue === 'string' && !castedValue.startsWith('{') && !castedValue.startsWith('date')) {
          return `${p.prop}:"${castedValue.replace(/"/g, "'")}"`;
        }
        // For numbers, booleans, lists, records, dates - no quotes
        return `${p.prop}:${castedValue}`;
      });
      return ` with properties {${propStrings.join(', ')}}`;
    }

    const script = `
      tell application "Terminal"
        tell ${castedWindow}
          save it${inParam_optional_file ? ' in ' + valueForScriptIn : ''}
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      message: result,
      script: script,
      window: target_window_required_string,
      in: inParam_optional_file || null
    };
  }

  async printFile(direct_parameter_required_list_of_file, with_properties_optional_print_settings, print_dialog_optional_boolean) {
    if (direct_parameter_required_list_of_file === undefined || direct_parameter_required_list_of_file === null) {
      throw new Error("direct_parameter_required_list_of_file is required");
    }

    const castedDirect_parameter = direct_parameter_required_list_of_file ? castAndEscape(direct_parameter_required_list_of_file) : null;
    const castedWith_properties = with_properties_optional_print_settings ? castAndEscape(with_properties_optional_print_settings) : null;
    const castedPrint_dialog = print_dialog_optional_boolean ? castAndEscape(print_dialog_optional_boolean) : null;

    const script = `
      tell application "Terminal"
        print ${castedDirect_parameter}${with_properties_optional_print_settings ? ' with properties ' + castedWith_properties : ''}${print_dialog_optional_boolean ? ' print dialog ' + castedPrint_dialog : ''}
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      message: result,
      script: script,
      direct_parameter: direct_parameter_required_list_of_file || null,
      with_properties: with_properties_optional_print_settings || null,
      print_dialog: print_dialog_optional_boolean || null
    };
  }

  async printForDocument(target_document_required_string, with_properties_optional_print_settings, print_dialog_optional_boolean) {
    if (!target_document_required_string || typeof target_document_required_string !== "string") {
      throw new Error("target_document_required_string is required and must be a string");
    }

    const castedDocument = castAndEscape(target_document_required_string);
    const castedWith_properties = with_properties_optional_print_settings ? castAndEscape(with_properties_optional_print_settings) : null;
    const valueForScriptWith_properties = castedWith_properties && typeof castedWith_properties === 'string' && !castedWith_properties.startsWith('{') && !castedWith_properties.startsWith('date') ? `"${castedWith_properties.replace(/"/g, "'")}"` : castedWith_properties;
    const castedPrint_dialog = print_dialog_optional_boolean ? castAndEscape(print_dialog_optional_boolean) : null;
    const valueForScriptPrint_dialog = castedPrint_dialog && typeof castedPrint_dialog === 'string' && !castedPrint_dialog.startsWith('{') && !castedPrint_dialog.startsWith('date') ? `"${castedPrint_dialog.replace(/"/g, "'")}"` : castedPrint_dialog;

    // Helper function to build properties record from individual property parameters
    function buildPropertiesRecord(propertyParams) {
      const definedProps = propertyParams.filter(p => p.value !== undefined && p.value !== null && p.value !== '');
      if (definedProps.length === 0) return '';
      const propStrings = definedProps.map(p => {
        const castedValue = castAndEscape(p.value, p.type || null);
        // For strings that got escaped, wrap in quotes and replace inner quotes
        if (typeof castedValue === 'string' && !castedValue.startsWith('{') && !castedValue.startsWith('date')) {
          return `${p.prop}:"${castedValue.replace(/"/g, "'")}"`;
        }
        // For numbers, booleans, lists, records, dates - no quotes
        return `${p.prop}:${castedValue}`;
      });
      return ` with properties {${propStrings.join(', ')}}`;
    }

    const script = `
      tell application "Terminal"
        tell ${castedDocument}
          print it${with_properties_optional_print_settings ? ' with properties ' + valueForScriptWith_properties : ''}${print_dialog_optional_boolean ? ' print dialog ' + valueForScriptPrint_dialog : ''}
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      message: result,
      script: script,
      document: target_document_required_string,
      with_properties: with_properties_optional_print_settings || null,
      print_dialog: print_dialog_optional_boolean || null
    };
  }

  async printForWindow(target_window_required_string, with_properties_optional_print_settings, print_dialog_optional_boolean) {
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }

    const castedWindow = castAndEscape(target_window_required_string);
    const castedWith_properties = with_properties_optional_print_settings ? castAndEscape(with_properties_optional_print_settings) : null;
    const valueForScriptWith_properties = castedWith_properties && typeof castedWith_properties === 'string' && !castedWith_properties.startsWith('{') && !castedWith_properties.startsWith('date') ? `"${castedWith_properties.replace(/"/g, "'")}"` : castedWith_properties;
    const castedPrint_dialog = print_dialog_optional_boolean ? castAndEscape(print_dialog_optional_boolean) : null;
    const valueForScriptPrint_dialog = castedPrint_dialog && typeof castedPrint_dialog === 'string' && !castedPrint_dialog.startsWith('{') && !castedPrint_dialog.startsWith('date') ? `"${castedPrint_dialog.replace(/"/g, "'")}"` : castedPrint_dialog;

    // Helper function to build properties record from individual property parameters
    function buildPropertiesRecord(propertyParams) {
      const definedProps = propertyParams.filter(p => p.value !== undefined && p.value !== null && p.value !== '');
      if (definedProps.length === 0) return '';
      const propStrings = definedProps.map(p => {
        const castedValue = castAndEscape(p.value, p.type || null);
        // For strings that got escaped, wrap in quotes and replace inner quotes
        if (typeof castedValue === 'string' && !castedValue.startsWith('{') && !castedValue.startsWith('date')) {
          return `${p.prop}:"${castedValue.replace(/"/g, "'")}"`;
        }
        // For numbers, booleans, lists, records, dates - no quotes
        return `${p.prop}:${castedValue}`;
      });
      return ` with properties {${propStrings.join(', ')}}`;
    }

    const script = `
      tell application "Terminal"
        tell ${castedWindow}
          print it${with_properties_optional_print_settings ? ' with properties ' + valueForScriptWith_properties : ''}${print_dialog_optional_boolean ? ' print dialog ' + valueForScriptPrint_dialog : ''}
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      message: result,
      script: script,
      window: target_window_required_string,
      with_properties: with_properties_optional_print_settings || null,
      print_dialog: print_dialog_optional_boolean || null
    };
  }

  async quit(saving_optional_save_options) {
    const castedSaving = saving_optional_save_options ? castAndEscape(saving_optional_save_options) : null;

    const script = `
      tell application "Terminal"
        quit${saving_optional_save_options ? ' saving ' + castedSaving : ''}
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      message: result,
      script: script,
      saving: saving_optional_save_options || null
    };
  }

  async countDocument() {


    // Helper function to build properties record from individual property parameters
    function buildPropertiesRecord(propertyParams) {
      const definedProps = propertyParams.filter(p => p.value !== undefined && p.value !== null && p.value !== '');
      if (definedProps.length === 0) return '';
      const propStrings = definedProps.map(p => {
        const castedValue = castAndEscape(p.value, p.type || null);
        // For strings that got escaped, wrap in quotes and replace inner quotes
        if (typeof castedValue === 'string' && !castedValue.startsWith('{') && !castedValue.startsWith('date')) {
          return `${p.prop}:"${castedValue.replace(/"/g, "'")}"`;
        }
        // For numbers, booleans, lists, records, dates - no quotes
        return `${p.prop}:${castedValue}`;
      });
      return ` with properties {${propStrings.join(', ')}}`;
    }

    const script = `
      tell application "Terminal"
        count each document 
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      message: result,
      script: script
    };
  }

  async countTabOfWindow(target_window_required_string) {
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }

    const castedWindow = castAndEscape(target_window_required_string);

    // Helper function to build properties record from individual property parameters
    function buildPropertiesRecord(propertyParams) {
      const definedProps = propertyParams.filter(p => p.value !== undefined && p.value !== null && p.value !== '');
      if (definedProps.length === 0) return '';
      const propStrings = definedProps.map(p => {
        const castedValue = castAndEscape(p.value, p.type || null);
        // For strings that got escaped, wrap in quotes and replace inner quotes
        if (typeof castedValue === 'string' && !castedValue.startsWith('{') && !castedValue.startsWith('date')) {
          return `${p.prop}:"${castedValue.replace(/"/g, "'")}"`;
        }
        // For numbers, booleans, lists, records, dates - no quotes
        return `${p.prop}:${castedValue}`;
      });
      return ` with properties {${propStrings.join(', ')}}`;
    }

    const script = `
      tell application "Terminal"
        tell ${castedWindow}
          count each tab of it 
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      message: result,
      script: script,
      window: target_window_required_string
    };
  }

  async countSettingsSet() {


    // Helper function to build properties record from individual property parameters
    function buildPropertiesRecord(propertyParams) {
      const definedProps = propertyParams.filter(p => p.value !== undefined && p.value !== null && p.value !== '');
      if (definedProps.length === 0) return '';
      const propStrings = definedProps.map(p => {
        const castedValue = castAndEscape(p.value, p.type || null);
        // For strings that got escaped, wrap in quotes and replace inner quotes
        if (typeof castedValue === 'string' && !castedValue.startsWith('{') && !castedValue.startsWith('date')) {
          return `${p.prop}:"${castedValue.replace(/"/g, "'")}"`;
        }
        // For numbers, booleans, lists, records, dates - no quotes
        return `${p.prop}:${castedValue}`;
      });
      return ` with properties {${propStrings.join(', ')}}`;
    }

    const script = `
      tell application "Terminal"
        count each settings set 
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      message: result,
      script: script
    };
  }

  async countWindow() {


    // Helper function to build properties record from individual property parameters
    function buildPropertiesRecord(propertyParams) {
      const definedProps = propertyParams.filter(p => p.value !== undefined && p.value !== null && p.value !== '');
      if (definedProps.length === 0) return '';
      const propStrings = definedProps.map(p => {
        const castedValue = castAndEscape(p.value, p.type || null);
        // For strings that got escaped, wrap in quotes and replace inner quotes
        if (typeof castedValue === 'string' && !castedValue.startsWith('{') && !castedValue.startsWith('date')) {
          return `${p.prop}:"${castedValue.replace(/"/g, "'")}"`;
        }
        // For numbers, booleans, lists, records, dates - no quotes
        return `${p.prop}:${castedValue}`;
      });
      return ` with properties {${propStrings.join(', ')}}`;
    }

    const script = `
      tell application "Terminal"
        count each window 
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      message: result,
      script: script
    };
  }

  async delete(direct_parameter_required_specifier) {
    if (direct_parameter_required_specifier === undefined || direct_parameter_required_specifier === null) {
      throw new Error("direct_parameter_required_specifier is required");
    }

    const castedDirect_parameter = direct_parameter_required_specifier ? castAndEscape(direct_parameter_required_specifier) : null;

    const script = `
      tell application "Terminal"
        delete ${castedDirect_parameter}
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      message: result,
      script: script,
      direct_parameter: direct_parameter_required_specifier || null
    };
  }

  async duplicate(direct_parameter_required_specifier, to_required_location_specifier, with_properties_optional_record) {
    if (direct_parameter_required_specifier === undefined || direct_parameter_required_specifier === null) {
      throw new Error("direct_parameter_required_specifier is required");
    }

    if (to_required_location_specifier === undefined || to_required_location_specifier === null) {
      throw new Error("to_required_location_specifier is required");
    }

    const castedDirect_parameter = direct_parameter_required_specifier ? castAndEscape(direct_parameter_required_specifier) : null;
    const castedTo = to_required_location_specifier ? castAndEscape(to_required_location_specifier) : null;
    const castedWith_properties = with_properties_optional_record ? castAndEscape(with_properties_optional_record) : null;

    const script = `
      tell application "Terminal"
        duplicate ${castedDirect_parameter} to ${castedTo}${with_properties_optional_record ? ' with properties ' + castedWith_properties : ''}
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      message: result,
      script: script,
      direct_parameter: direct_parameter_required_specifier || null,
      to: to_required_location_specifier || null,
      with_properties: with_properties_optional_record || null
    };
  }

  async exists(direct_parameter_required_specifier) {
    if (direct_parameter_required_specifier === undefined || direct_parameter_required_specifier === null) {
      throw new Error("direct_parameter_required_specifier is required");
    }

    const castedDirect_parameter = direct_parameter_required_specifier ? castAndEscape(direct_parameter_required_specifier) : null;

    const script = `
      tell application "Terminal"
        exists ${castedDirect_parameter}
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      message: result,
      script: script,
      direct_parameter: direct_parameter_required_specifier || null
    };
  }

  async makeDocument(at_optional_location_specifier, with_data_optional_any) {

    const castedAt = at_optional_location_specifier ? castAndEscape(at_optional_location_specifier) : null;
    const valueForScriptAt = castedAt && typeof castedAt === 'string' && !castedAt.startsWith('{') && !castedAt.startsWith('date') ? `"${castedAt.replace(/"/g, "'")}"` : castedAt;
    const castedWith_data = with_data_optional_any ? castAndEscape(with_data_optional_any) : null;
    const valueForScriptWith_data = castedWith_data && typeof castedWith_data === 'string' && !castedWith_data.startsWith('{') && !castedWith_data.startsWith('date') ? `"${castedWith_data.replace(/"/g, "'")}"` : castedWith_data;

    // Helper function to build properties record from individual property parameters
    function buildPropertiesRecord(propertyParams) {
      const definedProps = propertyParams.filter(p => p.value !== undefined && p.value !== null && p.value !== '');
      if (definedProps.length === 0) return '';
      const propStrings = definedProps.map(p => {
        const castedValue = castAndEscape(p.value, p.type || null);
        // For strings that got escaped, wrap in quotes and replace inner quotes
        if (typeof castedValue === 'string' && !castedValue.startsWith('{') && !castedValue.startsWith('date')) {
          return `${p.prop}:"${castedValue.replace(/"/g, "'")}"`;
        }
        // For numbers, booleans, lists, records, dates - no quotes
        return `${p.prop}:${castedValue}`;
      });
      return ` with properties {${propStrings.join(', ')}}`;
    }

    const script = `
      tell application "Terminal"
        make new document ${at_optional_location_specifier ? ' at ' + valueForScriptAt : ''}${with_data_optional_any ? ' with data ' + valueForScriptWith_data : ''}
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      message: result,
      script: script,
      at: at_optional_location_specifier || null,
      with_data: with_data_optional_any || null
    };
  }

  async makeTabOfWindow(at_required_location_specifier_window, with_data_optional_any, with_properties_optional_text_font_name, with_properties_optional_color_cursor_color, with_properties_optional_boolean_title_displays_custom_title, with_properties_optional_text_custom_title, with_properties_optional_color_background_color, with_properties_optional_color_bold_text_color, with_properties_optional_boolean_title_displays_file_name, with_properties_optional_boolean_title_displays_device_name, with_properties_optional_integer_number_of_columns, with_properties_optional_integer_number_of_rows, with_properties_optional_boolean_title_displays_shell_path, with_properties_optional_color_normal_text_color, with_properties_optional_missing_value_clean_commands, with_properties_optional_boolean_selected, with_properties_optional_integer_font_size, with_properties_optional_boolean_font_antialiasing, with_properties_optional_settings_set_current_settings, with_properties_optional_boolean_title_displays_window_size) {
    if (!at_required_location_specifier_window || typeof at_required_location_specifier_window !== "string") {
      throw new Error("at_required_location_specifier_window is required and must be a string");
    }

    const castedWindow = castAndEscape(at_required_location_specifier_window);
    const castedWith_data = with_data_optional_any ? castAndEscape(with_data_optional_any) : null;
    const valueForScriptWith_data = castedWith_data && typeof castedWith_data === 'string' && !castedWith_data.startsWith('{') && !castedWith_data.startsWith('date') ? `"${castedWith_data.replace(/"/g, "'")}"` : castedWith_data;
    const castedWith_properties_optional_text_font_name = with_properties_optional_text_font_name ? castAndEscape(with_properties_optional_text_font_name) : null;
    const castedWith_properties_optional_color_cursor_color = with_properties_optional_color_cursor_color ? castAndEscape(with_properties_optional_color_cursor_color) : null;
    const castedWith_properties_optional_boolean_title_displays_custom_title = with_properties_optional_boolean_title_displays_custom_title ? castAndEscape(with_properties_optional_boolean_title_displays_custom_title) : null;
    const castedWith_properties_optional_text_custom_title = with_properties_optional_text_custom_title ? castAndEscape(with_properties_optional_text_custom_title) : null;
    const castedWith_properties_optional_color_background_color = with_properties_optional_color_background_color ? castAndEscape(with_properties_optional_color_background_color) : null;
    const castedWith_properties_optional_color_bold_text_color = with_properties_optional_color_bold_text_color ? castAndEscape(with_properties_optional_color_bold_text_color) : null;
    const castedWith_properties_optional_boolean_title_displays_file_name = with_properties_optional_boolean_title_displays_file_name ? castAndEscape(with_properties_optional_boolean_title_displays_file_name) : null;
    const castedWith_properties_optional_boolean_title_displays_device_name = with_properties_optional_boolean_title_displays_device_name ? castAndEscape(with_properties_optional_boolean_title_displays_device_name) : null;
    const castedWith_properties_optional_integer_number_of_columns = with_properties_optional_integer_number_of_columns ? castAndEscape(with_properties_optional_integer_number_of_columns) : null;
    const castedWith_properties_optional_integer_number_of_rows = with_properties_optional_integer_number_of_rows ? castAndEscape(with_properties_optional_integer_number_of_rows) : null;
    const castedWith_properties_optional_boolean_title_displays_shell_path = with_properties_optional_boolean_title_displays_shell_path ? castAndEscape(with_properties_optional_boolean_title_displays_shell_path) : null;
    const castedWith_properties_optional_color_normal_text_color = with_properties_optional_color_normal_text_color ? castAndEscape(with_properties_optional_color_normal_text_color) : null;
    const castedWith_properties_optional_missing_value_clean_commands = with_properties_optional_missing_value_clean_commands ? castAndEscape(with_properties_optional_missing_value_clean_commands) : null;
    const castedWith_properties_optional_boolean_selected = with_properties_optional_boolean_selected ? castAndEscape(with_properties_optional_boolean_selected) : null;
    const castedWith_properties_optional_integer_font_size = with_properties_optional_integer_font_size ? castAndEscape(with_properties_optional_integer_font_size) : null;
    const castedWith_properties_optional_boolean_font_antialiasing = with_properties_optional_boolean_font_antialiasing ? castAndEscape(with_properties_optional_boolean_font_antialiasing) : null;
    const castedWith_properties_optional_settings_set_current_settings = with_properties_optional_settings_set_current_settings ? castAndEscape(with_properties_optional_settings_set_current_settings) : null;
    const castedWith_properties_optional_boolean_title_displays_window_size = with_properties_optional_boolean_title_displays_window_size ? castAndEscape(with_properties_optional_boolean_title_displays_window_size) : null;

    // Helper function to build properties record from individual property parameters
    function buildPropertiesRecord(propertyParams) {
      const definedProps = propertyParams.filter(p => p.value !== undefined && p.value !== null && p.value !== '');
      if (definedProps.length === 0) return '';
      const propStrings = definedProps.map(p => {
        const castedValue = castAndEscape(p.value, p.type || null);
        // For strings that got escaped, wrap in quotes and replace inner quotes
        if (typeof castedValue === 'string' && !castedValue.startsWith('{') && !castedValue.startsWith('date')) {
          return `${p.prop}:"${castedValue.replace(/"/g, "'")}"`;
        }
        // For numbers, booleans, lists, records, dates - no quotes
        return `${p.prop}:${castedValue}`;
      });
      return ` with properties {${propStrings.join(', ')}}`;
    }

    const script = `
      tell application "Terminal"
        tell ${castedWindow}
          make new tab at it ${with_data_optional_any ? ' with data ' + valueForScriptWith_data : ''}${buildPropertiesRecord([{param: 'with_properties_optional_text_font_name', prop: 'font name', value: with_properties_optional_text_font_name, type: 'text'}, {param: 'with_properties_optional_color_cursor_color', prop: 'cursor color', value: with_properties_optional_color_cursor_color, type: 'color'}, {param: 'with_properties_optional_boolean_title_displays_custom_title', prop: 'title displays custom title', value: with_properties_optional_boolean_title_displays_custom_title, type: 'boolean'}, {param: 'with_properties_optional_text_custom_title', prop: 'custom title', value: with_properties_optional_text_custom_title, type: 'text'}, {param: 'with_properties_optional_color_background_color', prop: 'background color', value: with_properties_optional_color_background_color, type: 'color'}, {param: 'with_properties_optional_color_bold_text_color', prop: 'bold text color', value: with_properties_optional_color_bold_text_color, type: 'color'}, {param: 'with_properties_optional_boolean_title_displays_file_name', prop: 'title displays file name', value: with_properties_optional_boolean_title_displays_file_name, type: 'boolean'}, {param: 'with_properties_optional_boolean_title_displays_device_name', prop: 'title displays device name', value: with_properties_optional_boolean_title_displays_device_name, type: 'boolean'}, {param: 'with_properties_optional_integer_number_of_columns', prop: 'number of columns', value: with_properties_optional_integer_number_of_columns, type: 'integer'}, {param: 'with_properties_optional_integer_number_of_rows', prop: 'number of rows', value: with_properties_optional_integer_number_of_rows, type: 'integer'}, {param: 'with_properties_optional_boolean_title_displays_shell_path', prop: 'title displays shell path', value: with_properties_optional_boolean_title_displays_shell_path, type: 'boolean'}, {param: 'with_properties_optional_color_normal_text_color', prop: 'normal text color', value: with_properties_optional_color_normal_text_color, type: 'color'}, {param: 'with_properties_optional_missing_value_clean_commands', prop: 'clean commands', value: with_properties_optional_missing_value_clean_commands, type: 'missing value'}, {param: 'with_properties_optional_boolean_selected', prop: 'selected', value: with_properties_optional_boolean_selected, type: 'boolean'}, {param: 'with_properties_optional_integer_font_size', prop: 'font size', value: with_properties_optional_integer_font_size, type: 'integer'}, {param: 'with_properties_optional_boolean_font_antialiasing', prop: 'font antialiasing', value: with_properties_optional_boolean_font_antialiasing, type: 'boolean'}, {param: 'with_properties_optional_settings_set_current_settings', prop: 'current settings', value: with_properties_optional_settings_set_current_settings, type: 'settings set'}, {param: 'with_properties_optional_boolean_title_displays_window_size', prop: 'title displays window size', value: with_properties_optional_boolean_title_displays_window_size, type: 'boolean'}])}
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      message: result,
      script: script,
      window: at_required_location_specifier_window,
      with_data: with_data_optional_any || null,
      font_name: with_properties_optional_text_font_name || null,
      cursor_color: with_properties_optional_color_cursor_color || null,
      title_displays_custom_title: with_properties_optional_boolean_title_displays_custom_title || null,
      custom_title: with_properties_optional_text_custom_title || null,
      background_color: with_properties_optional_color_background_color || null,
      bold_text_color: with_properties_optional_color_bold_text_color || null,
      title_displays_file_name: with_properties_optional_boolean_title_displays_file_name || null,
      title_displays_device_name: with_properties_optional_boolean_title_displays_device_name || null,
      number_of_columns: with_properties_optional_integer_number_of_columns || null,
      number_of_rows: with_properties_optional_integer_number_of_rows || null,
      title_displays_shell_path: with_properties_optional_boolean_title_displays_shell_path || null,
      normal_text_color: with_properties_optional_color_normal_text_color || null,
      clean_commands: with_properties_optional_missing_value_clean_commands || null,
      selected: with_properties_optional_boolean_selected || null,
      font_size: with_properties_optional_integer_font_size || null,
      font_antialiasing: with_properties_optional_boolean_font_antialiasing || null,
      current_settings: with_properties_optional_settings_set_current_settings || null,
      title_displays_window_size: with_properties_optional_boolean_title_displays_window_size || null
    };
  }

  async makeSettingsSet(at_optional_location_specifier, with_data_optional_any, with_properties_optional_color_bold_text_color, with_properties_optional_integer_number_of_columns, with_properties_optional_boolean_title_displays_shell_path, with_properties_optional_boolean_title_displays_window_size, with_properties_optional_color_cursor_color, with_properties_optional_boolean_font_antialiasing, with_properties_optional_missing_value_clean_commands, with_properties_optional_color_background_color, with_properties_optional_text_font_name, with_properties_optional_integer_font_size, with_properties_optional_boolean_title_displays_settings_name, with_properties_optional_integer_number_of_rows, with_properties_optional_boolean_title_displays_custom_title, with_properties_optional_text_custom_title, with_properties_optional_boolean_title_displays_device_name, with_properties_optional_color_normal_text_color, with_properties_optional_text_name) {

    const castedAt = at_optional_location_specifier ? castAndEscape(at_optional_location_specifier) : null;
    const valueForScriptAt = castedAt && typeof castedAt === 'string' && !castedAt.startsWith('{') && !castedAt.startsWith('date') ? `"${castedAt.replace(/"/g, "'")}"` : castedAt;
    const castedWith_data = with_data_optional_any ? castAndEscape(with_data_optional_any) : null;
    const valueForScriptWith_data = castedWith_data && typeof castedWith_data === 'string' && !castedWith_data.startsWith('{') && !castedWith_data.startsWith('date') ? `"${castedWith_data.replace(/"/g, "'")}"` : castedWith_data;
    const castedWith_properties_optional_color_bold_text_color = with_properties_optional_color_bold_text_color ? castAndEscape(with_properties_optional_color_bold_text_color) : null;
    const castedWith_properties_optional_integer_number_of_columns = with_properties_optional_integer_number_of_columns ? castAndEscape(with_properties_optional_integer_number_of_columns) : null;
    const castedWith_properties_optional_boolean_title_displays_shell_path = with_properties_optional_boolean_title_displays_shell_path ? castAndEscape(with_properties_optional_boolean_title_displays_shell_path) : null;
    const castedWith_properties_optional_boolean_title_displays_window_size = with_properties_optional_boolean_title_displays_window_size ? castAndEscape(with_properties_optional_boolean_title_displays_window_size) : null;
    const castedWith_properties_optional_color_cursor_color = with_properties_optional_color_cursor_color ? castAndEscape(with_properties_optional_color_cursor_color) : null;
    const castedWith_properties_optional_boolean_font_antialiasing = with_properties_optional_boolean_font_antialiasing ? castAndEscape(with_properties_optional_boolean_font_antialiasing) : null;
    const castedWith_properties_optional_missing_value_clean_commands = with_properties_optional_missing_value_clean_commands ? castAndEscape(with_properties_optional_missing_value_clean_commands) : null;
    const castedWith_properties_optional_color_background_color = with_properties_optional_color_background_color ? castAndEscape(with_properties_optional_color_background_color) : null;
    const castedWith_properties_optional_text_font_name = with_properties_optional_text_font_name ? castAndEscape(with_properties_optional_text_font_name) : null;
    const castedWith_properties_optional_integer_font_size = with_properties_optional_integer_font_size ? castAndEscape(with_properties_optional_integer_font_size) : null;
    const castedWith_properties_optional_boolean_title_displays_settings_name = with_properties_optional_boolean_title_displays_settings_name ? castAndEscape(with_properties_optional_boolean_title_displays_settings_name) : null;
    const castedWith_properties_optional_integer_number_of_rows = with_properties_optional_integer_number_of_rows ? castAndEscape(with_properties_optional_integer_number_of_rows) : null;
    const castedWith_properties_optional_boolean_title_displays_custom_title = with_properties_optional_boolean_title_displays_custom_title ? castAndEscape(with_properties_optional_boolean_title_displays_custom_title) : null;
    const castedWith_properties_optional_text_custom_title = with_properties_optional_text_custom_title ? castAndEscape(with_properties_optional_text_custom_title) : null;
    const castedWith_properties_optional_boolean_title_displays_device_name = with_properties_optional_boolean_title_displays_device_name ? castAndEscape(with_properties_optional_boolean_title_displays_device_name) : null;
    const castedWith_properties_optional_color_normal_text_color = with_properties_optional_color_normal_text_color ? castAndEscape(with_properties_optional_color_normal_text_color) : null;
    const castedWith_properties_optional_text_name = with_properties_optional_text_name ? castAndEscape(with_properties_optional_text_name) : null;

    // Helper function to build properties record from individual property parameters
    function buildPropertiesRecord(propertyParams) {
      const definedProps = propertyParams.filter(p => p.value !== undefined && p.value !== null && p.value !== '');
      if (definedProps.length === 0) return '';
      const propStrings = definedProps.map(p => {
        const castedValue = castAndEscape(p.value, p.type || null);
        // For strings that got escaped, wrap in quotes and replace inner quotes
        if (typeof castedValue === 'string' && !castedValue.startsWith('{') && !castedValue.startsWith('date')) {
          return `${p.prop}:"${castedValue.replace(/"/g, "'")}"`;
        }
        // For numbers, booleans, lists, records, dates - no quotes
        return `${p.prop}:${castedValue}`;
      });
      return ` with properties {${propStrings.join(', ')}}`;
    }

    const script = `
      tell application "Terminal"
        make new settings set ${at_optional_location_specifier ? ' at ' + valueForScriptAt : ''}${with_data_optional_any ? ' with data ' + valueForScriptWith_data : ''}${buildPropertiesRecord([{param: 'with_properties_optional_color_bold_text_color', prop: 'bold text color', value: with_properties_optional_color_bold_text_color, type: 'color'}, {param: 'with_properties_optional_integer_number_of_columns', prop: 'number of columns', value: with_properties_optional_integer_number_of_columns, type: 'integer'}, {param: 'with_properties_optional_boolean_title_displays_shell_path', prop: 'title displays shell path', value: with_properties_optional_boolean_title_displays_shell_path, type: 'boolean'}, {param: 'with_properties_optional_boolean_title_displays_window_size', prop: 'title displays window size', value: with_properties_optional_boolean_title_displays_window_size, type: 'boolean'}, {param: 'with_properties_optional_color_cursor_color', prop: 'cursor color', value: with_properties_optional_color_cursor_color, type: 'color'}, {param: 'with_properties_optional_boolean_font_antialiasing', prop: 'font antialiasing', value: with_properties_optional_boolean_font_antialiasing, type: 'boolean'}, {param: 'with_properties_optional_missing_value_clean_commands', prop: 'clean commands', value: with_properties_optional_missing_value_clean_commands, type: 'missing value'}, {param: 'with_properties_optional_color_background_color', prop: 'background color', value: with_properties_optional_color_background_color, type: 'color'}, {param: 'with_properties_optional_text_font_name', prop: 'font name', value: with_properties_optional_text_font_name, type: 'text'}, {param: 'with_properties_optional_integer_font_size', prop: 'font size', value: with_properties_optional_integer_font_size, type: 'integer'}, {param: 'with_properties_optional_boolean_title_displays_settings_name', prop: 'title displays settings name', value: with_properties_optional_boolean_title_displays_settings_name, type: 'boolean'}, {param: 'with_properties_optional_integer_number_of_rows', prop: 'number of rows', value: with_properties_optional_integer_number_of_rows, type: 'integer'}, {param: 'with_properties_optional_boolean_title_displays_custom_title', prop: 'title displays custom title', value: with_properties_optional_boolean_title_displays_custom_title, type: 'boolean'}, {param: 'with_properties_optional_text_custom_title', prop: 'custom title', value: with_properties_optional_text_custom_title, type: 'text'}, {param: 'with_properties_optional_boolean_title_displays_device_name', prop: 'title displays device name', value: with_properties_optional_boolean_title_displays_device_name, type: 'boolean'}, {param: 'with_properties_optional_color_normal_text_color', prop: 'normal text color', value: with_properties_optional_color_normal_text_color, type: 'color'}, {param: 'with_properties_optional_text_name', prop: 'name', value: with_properties_optional_text_name, type: 'text'}])}
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      message: result,
      script: script,
      at: at_optional_location_specifier || null,
      with_data: with_data_optional_any || null,
      bold_text_color: with_properties_optional_color_bold_text_color || null,
      number_of_columns: with_properties_optional_integer_number_of_columns || null,
      title_displays_shell_path: with_properties_optional_boolean_title_displays_shell_path || null,
      title_displays_window_size: with_properties_optional_boolean_title_displays_window_size || null,
      cursor_color: with_properties_optional_color_cursor_color || null,
      font_antialiasing: with_properties_optional_boolean_font_antialiasing || null,
      clean_commands: with_properties_optional_missing_value_clean_commands || null,
      background_color: with_properties_optional_color_background_color || null,
      font_name: with_properties_optional_text_font_name || null,
      font_size: with_properties_optional_integer_font_size || null,
      title_displays_settings_name: with_properties_optional_boolean_title_displays_settings_name || null,
      number_of_rows: with_properties_optional_integer_number_of_rows || null,
      title_displays_custom_title: with_properties_optional_boolean_title_displays_custom_title || null,
      custom_title: with_properties_optional_text_custom_title || null,
      title_displays_device_name: with_properties_optional_boolean_title_displays_device_name || null,
      normal_text_color: with_properties_optional_color_normal_text_color || null,
      name: with_properties_optional_text_name || null
    };
  }

  async makeWindow(at_optional_location_specifier, with_data_optional_any, with_properties_optional_integer_index, with_properties_optional_point_position, with_properties_optional_rectangle_frame, with_properties_optional_boolean_frontmost, with_properties_optional_boolean_zoomed, with_properties_optional_boolean_miniaturized, with_properties_optional_point_size, with_properties_optional_boolean_visible, with_properties_optional_point_origin, with_properties_optional_rectangle_bounds) {

    const castedAt = at_optional_location_specifier ? castAndEscape(at_optional_location_specifier) : null;
    const valueForScriptAt = castedAt && typeof castedAt === 'string' && !castedAt.startsWith('{') && !castedAt.startsWith('date') ? `"${castedAt.replace(/"/g, "'")}"` : castedAt;
    const castedWith_data = with_data_optional_any ? castAndEscape(with_data_optional_any) : null;
    const valueForScriptWith_data = castedWith_data && typeof castedWith_data === 'string' && !castedWith_data.startsWith('{') && !castedWith_data.startsWith('date') ? `"${castedWith_data.replace(/"/g, "'")}"` : castedWith_data;
    const castedWith_properties_optional_integer_index = with_properties_optional_integer_index ? castAndEscape(with_properties_optional_integer_index) : null;
    const castedWith_properties_optional_point_position = with_properties_optional_point_position ? castAndEscape(with_properties_optional_point_position) : null;
    const castedWith_properties_optional_rectangle_frame = with_properties_optional_rectangle_frame ? castAndEscape(with_properties_optional_rectangle_frame) : null;
    const castedWith_properties_optional_boolean_frontmost = with_properties_optional_boolean_frontmost ? castAndEscape(with_properties_optional_boolean_frontmost) : null;
    const castedWith_properties_optional_boolean_zoomed = with_properties_optional_boolean_zoomed ? castAndEscape(with_properties_optional_boolean_zoomed) : null;
    const castedWith_properties_optional_boolean_miniaturized = with_properties_optional_boolean_miniaturized ? castAndEscape(with_properties_optional_boolean_miniaturized) : null;
    const castedWith_properties_optional_point_size = with_properties_optional_point_size ? castAndEscape(with_properties_optional_point_size) : null;
    const castedWith_properties_optional_boolean_visible = with_properties_optional_boolean_visible ? castAndEscape(with_properties_optional_boolean_visible) : null;
    const castedWith_properties_optional_point_origin = with_properties_optional_point_origin ? castAndEscape(with_properties_optional_point_origin) : null;
    const castedWith_properties_optional_rectangle_bounds = with_properties_optional_rectangle_bounds ? castAndEscape(with_properties_optional_rectangle_bounds) : null;

    // Helper function to build properties record from individual property parameters
    function buildPropertiesRecord(propertyParams) {
      const definedProps = propertyParams.filter(p => p.value !== undefined && p.value !== null && p.value !== '');
      if (definedProps.length === 0) return '';
      const propStrings = definedProps.map(p => {
        const castedValue = castAndEscape(p.value, p.type || null);
        // For strings that got escaped, wrap in quotes and replace inner quotes
        if (typeof castedValue === 'string' && !castedValue.startsWith('{') && !castedValue.startsWith('date')) {
          return `${p.prop}:"${castedValue.replace(/"/g, "'")}"`;
        }
        // For numbers, booleans, lists, records, dates - no quotes
        return `${p.prop}:${castedValue}`;
      });
      return ` with properties {${propStrings.join(', ')}}`;
    }

    const script = `
      tell application "Terminal"
        make new window ${at_optional_location_specifier ? ' at ' + valueForScriptAt : ''}${with_data_optional_any ? ' with data ' + valueForScriptWith_data : ''}${buildPropertiesRecord([{param: 'with_properties_optional_integer_index', prop: 'index', value: with_properties_optional_integer_index, type: 'integer'}, {param: 'with_properties_optional_point_position', prop: 'position', value: with_properties_optional_point_position, type: 'point'}, {param: 'with_properties_optional_rectangle_frame', prop: 'frame', value: with_properties_optional_rectangle_frame, type: 'rectangle'}, {param: 'with_properties_optional_boolean_frontmost', prop: 'frontmost', value: with_properties_optional_boolean_frontmost, type: 'boolean'}, {param: 'with_properties_optional_boolean_zoomed', prop: 'zoomed', value: with_properties_optional_boolean_zoomed, type: 'boolean'}, {param: 'with_properties_optional_boolean_miniaturized', prop: 'miniaturized', value: with_properties_optional_boolean_miniaturized, type: 'boolean'}, {param: 'with_properties_optional_point_size', prop: 'size', value: with_properties_optional_point_size, type: 'point'}, {param: 'with_properties_optional_boolean_visible', prop: 'visible', value: with_properties_optional_boolean_visible, type: 'boolean'}, {param: 'with_properties_optional_point_origin', prop: 'origin', value: with_properties_optional_point_origin, type: 'point'}, {param: 'with_properties_optional_rectangle_bounds', prop: 'bounds', value: with_properties_optional_rectangle_bounds, type: 'rectangle'}])}
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      message: result,
      script: script,
      at: at_optional_location_specifier || null,
      with_data: with_data_optional_any || null,
      index: with_properties_optional_integer_index || null,
      position: with_properties_optional_point_position || null,
      frame: with_properties_optional_rectangle_frame || null,
      frontmost: with_properties_optional_boolean_frontmost || null,
      zoomed: with_properties_optional_boolean_zoomed || null,
      miniaturized: with_properties_optional_boolean_miniaturized || null,
      size: with_properties_optional_point_size || null,
      visible: with_properties_optional_boolean_visible || null,
      origin: with_properties_optional_point_origin || null,
      bounds: with_properties_optional_rectangle_bounds || null
    };
  }

  async move(direct_parameter_required_specifier, to_required_location_specifier) {
    if (direct_parameter_required_specifier === undefined || direct_parameter_required_specifier === null) {
      throw new Error("direct_parameter_required_specifier is required");
    }

    if (to_required_location_specifier === undefined || to_required_location_specifier === null) {
      throw new Error("to_required_location_specifier is required");
    }

    const castedDirect_parameter = direct_parameter_required_specifier ? castAndEscape(direct_parameter_required_specifier) : null;
    const castedTo = to_required_location_specifier ? castAndEscape(to_required_location_specifier) : null;

    const script = `
      tell application "Terminal"
        move ${castedDirect_parameter} to ${castedTo}
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      message: result,
      script: script,
      direct_parameter: direct_parameter_required_specifier || null,
      to: to_required_location_specifier || null
    };
  }

  async getFrontmostOfWindow(target_window_required_string) {
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }

    const escapedWindow = escapeForAppleScript(target_window_required_string);

    const script = `
      tell application "Terminal"
        tell ${escapedWindow}
          return frontmost of it
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      value: result,
      script: script,
      window: target_window_required_string
    };
  }

  async setFrontmostOfWindow(target_window_required_string, value_required_boolean) {
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }
    if (value_required_boolean === undefined || value_required_boolean === null) {
      throw new Error("value_required_boolean is required");
    }

    const castedWindow = castAndEscape(target_window_required_string, 'string');
    const castedValue = castAndEscape(value_required_boolean, 'boolean');
    // Determine value format for AppleScript
    let valueForScript;
    if (typeof castedValue === 'string' && !castedValue.startsWith('{') && !castedValue.startsWith('date')) {
      valueForScript = `"${castedValue}"`; // Wrap strings in quotes
    } else {
      valueForScript = castedValue; // Use as-is for numbers, booleans, lists, records
    }

    const script = `
      tell application "Terminal"
        tell ${castedWindow}
          set frontmost of it to ${valueForScript}
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      message: "Property set successfully",
      value: value_required_boolean,
      script: script,
      window: target_window_required_string
    };
  }

  async getPositionOfWindow(target_window_required_string) {
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }

    const escapedWindow = escapeForAppleScript(target_window_required_string);

    const script = `
      tell application "Terminal"
        tell ${escapedWindow}
          return position of it
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      value: result,
      script: script,
      window: target_window_required_string
    };
  }

  async setPositionOfWindow(target_window_required_string, value_required_point) {
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }
    if (value_required_point === undefined || value_required_point === null) {
      throw new Error("value_required_point is required");
    }

    const castedWindow = castAndEscape(target_window_required_string, 'string');
    const castedValue = castAndEscape(value_required_point, 'point');
    // Determine value format for AppleScript
    let valueForScript;
    if (typeof castedValue === 'string' && !castedValue.startsWith('{') && !castedValue.startsWith('date')) {
      valueForScript = `"${castedValue}"`; // Wrap strings in quotes
    } else {
      valueForScript = castedValue; // Use as-is for numbers, booleans, lists, records
    }

    const script = `
      tell application "Terminal"
        tell ${castedWindow}
          set position of it to ${valueForScript}
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      message: "Property set successfully",
      value: value_required_point,
      script: script,
      window: target_window_required_string
    };
  }

  async getOriginOfWindow(target_window_required_string) {
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }

    const escapedWindow = escapeForAppleScript(target_window_required_string);

    const script = `
      tell application "Terminal"
        tell ${escapedWindow}
          return origin of it
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      value: result,
      script: script,
      window: target_window_required_string
    };
  }

  async setOriginOfWindow(target_window_required_string, value_required_point) {
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }
    if (value_required_point === undefined || value_required_point === null) {
      throw new Error("value_required_point is required");
    }

    const castedWindow = castAndEscape(target_window_required_string, 'string');
    const castedValue = castAndEscape(value_required_point, 'point');
    // Determine value format for AppleScript
    let valueForScript;
    if (typeof castedValue === 'string' && !castedValue.startsWith('{') && !castedValue.startsWith('date')) {
      valueForScript = `"${castedValue}"`; // Wrap strings in quotes
    } else {
      valueForScript = castedValue; // Use as-is for numbers, booleans, lists, records
    }

    const script = `
      tell application "Terminal"
        tell ${castedWindow}
          set origin of it to ${valueForScript}
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      message: "Property set successfully",
      value: value_required_point,
      script: script,
      window: target_window_required_string
    };
  }

  async getSizeOfWindow(target_window_required_string) {
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }

    const escapedWindow = escapeForAppleScript(target_window_required_string);

    const script = `
      tell application "Terminal"
        tell ${escapedWindow}
          return size of it
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      value: result,
      script: script,
      window: target_window_required_string
    };
  }

  async setSizeOfWindow(target_window_required_string, value_required_point) {
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }
    if (value_required_point === undefined || value_required_point === null) {
      throw new Error("value_required_point is required");
    }

    const castedWindow = castAndEscape(target_window_required_string, 'string');
    const castedValue = castAndEscape(value_required_point, 'point');
    // Determine value format for AppleScript
    let valueForScript;
    if (typeof castedValue === 'string' && !castedValue.startsWith('{') && !castedValue.startsWith('date')) {
      valueForScript = `"${castedValue}"`; // Wrap strings in quotes
    } else {
      valueForScript = castedValue; // Use as-is for numbers, booleans, lists, records
    }

    const script = `
      tell application "Terminal"
        tell ${castedWindow}
          set size of it to ${valueForScript}
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      message: "Property set successfully",
      value: value_required_point,
      script: script,
      window: target_window_required_string
    };
  }

  async getFrameOfWindow(target_window_required_string) {
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }

    const escapedWindow = escapeForAppleScript(target_window_required_string);

    const script = `
      tell application "Terminal"
        tell ${escapedWindow}
          return frame of it
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      value: result,
      script: script,
      window: target_window_required_string
    };
  }

  async setFrameOfWindow(target_window_required_string, value_required_rectangle) {
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }
    if (value_required_rectangle === undefined || value_required_rectangle === null) {
      throw new Error("value_required_rectangle is required");
    }

    const castedWindow = castAndEscape(target_window_required_string, 'string');
    const castedValue = castAndEscape(value_required_rectangle, 'rectangle');
    // Determine value format for AppleScript
    let valueForScript;
    if (typeof castedValue === 'string' && !castedValue.startsWith('{') && !castedValue.startsWith('date')) {
      valueForScript = `"${castedValue}"`; // Wrap strings in quotes
    } else {
      valueForScript = castedValue; // Use as-is for numbers, booleans, lists, records
    }

    const script = `
      tell application "Terminal"
        tell ${castedWindow}
          set frame of it to ${valueForScript}
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      message: "Property set successfully",
      value: value_required_rectangle,
      script: script,
      window: target_window_required_string
    };
  }

  async doScript(direct_parameter_optional_text, with_command_optional_text, inParam_optional_tab) {
    const castedDirect_parameter = direct_parameter_optional_text ? castAndEscape(direct_parameter_optional_text) : null;
    const castedWith_command = with_command_optional_text ? castAndEscape(with_command_optional_text) : null;
    const castedIn = inParam_optional_tab ? castAndEscape(inParam_optional_tab) : null;

    const script = `
      tell application "Terminal"
        do script${direct_parameter_optional_text ? ' "' + castedDirect_parameter + '"' : ''}${with_command_optional_text ? ' with command "' + castedWith_command + '"' : ''}${inParam_optional_tab ? ' in ' + castedIn : ''}
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      message: result,
      script: script,
      direct_parameter: direct_parameter_optional_text || null,
      with_command: with_command_optional_text || null,
      in: inParam_optional_tab || null
    };
  }

  async getUrl(direct_parameter_required_text) {
    if (direct_parameter_required_text === undefined || direct_parameter_required_text === null) {
      throw new Error("direct_parameter_required_text is required");
    }

    const castedDirect_parameter = direct_parameter_required_text ? castAndEscape(direct_parameter_required_text) : null;

    const script = `
      tell application "Terminal"
        get URL "${castedDirect_parameter}"
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      message: result,
      script: script,
      direct_parameter: direct_parameter_required_text || null
    };
  }

  async getDefaultSettingsOfApplication(target_application_required_string) {
    if (!target_application_required_string || typeof target_application_required_string !== "string") {
      throw new Error("target_application_required_string is required and must be a string");
    }

    const escapedApplication = escapeForAppleScript(target_application_required_string);

    const script = `
      tell application "Terminal"
        tell ${escapedApplication}
          return default settings of it
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      value: result,
      script: script,
      application: target_application_required_string
    };
  }

  async setDefaultSettingsOfApplication(target_application_required_string, value_required_settings_set) {
    if (!target_application_required_string || typeof target_application_required_string !== "string") {
      throw new Error("target_application_required_string is required and must be a string");
    }
    if (value_required_settings_set === undefined || value_required_settings_set === null) {
      throw new Error("value_required_settings_set is required");
    }

    const castedApplication = castAndEscape(target_application_required_string, 'string');
    const castedValue = castAndEscape(value_required_settings_set, 'settings set');
    // Determine value format for AppleScript
    let valueForScript;
    // Property type 'settings set' is a class reference - treat as object
    valueForScript = castedValue; // Object reference - no quotes

    const script = `
      tell application "Terminal"
        tell ${castedApplication}
          set default settings of it to ${valueForScript}
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      message: "Property set successfully",
      value: value_required_settings_set,
      script: script,
      application: target_application_required_string
    };
  }

  async getStartupSettingsOfApplication(target_application_required_string) {
    if (!target_application_required_string || typeof target_application_required_string !== "string") {
      throw new Error("target_application_required_string is required and must be a string");
    }

    const escapedApplication = escapeForAppleScript(target_application_required_string);

    const script = `
      tell application "Terminal"
        tell ${escapedApplication}
          return startup settings of it
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      value: result,
      script: script,
      application: target_application_required_string
    };
  }

  async setStartupSettingsOfApplication(target_application_required_string, value_required_settings_set) {
    if (!target_application_required_string || typeof target_application_required_string !== "string") {
      throw new Error("target_application_required_string is required and must be a string");
    }
    if (value_required_settings_set === undefined || value_required_settings_set === null) {
      throw new Error("value_required_settings_set is required");
    }

    const castedApplication = castAndEscape(target_application_required_string, 'string');
    const castedValue = castAndEscape(value_required_settings_set, 'settings set');
    // Determine value format for AppleScript
    let valueForScript;
    // Property type 'settings set' is a class reference - treat as object
    valueForScript = castedValue; // Object reference - no quotes

    const script = `
      tell application "Terminal"
        tell ${castedApplication}
          set startup settings of it to ${valueForScript}
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      message: "Property set successfully",
      value: value_required_settings_set,
      script: script,
      application: target_application_required_string
    };
  }

  async getIdOfSettingsSet(target_settings_set_required_string) {
    if (!target_settings_set_required_string || typeof target_settings_set_required_string !== "string") {
      throw new Error("target_settings_set_required_string is required and must be a string");
    }

    const escapedSettingsSet = escapeForAppleScript(target_settings_set_required_string);

    const script = `
      tell application "Terminal"
        tell ${escapedSettingsSet}
          return id of it
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      value: result,
      script: script,
      settings_set: target_settings_set_required_string
    };
  }

  async getNameOfSettingsSet(target_settings_set_required_string) {
    if (!target_settings_set_required_string || typeof target_settings_set_required_string !== "string") {
      throw new Error("target_settings_set_required_string is required and must be a string");
    }

    const escapedSettingsSet = escapeForAppleScript(target_settings_set_required_string);

    const script = `
      tell application "Terminal"
        tell ${escapedSettingsSet}
          return name of it
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      value: result,
      script: script,
      settings_set: target_settings_set_required_string
    };
  }

  async setNameOfSettingsSet(target_settings_set_required_string, value_required_text) {
    if (!target_settings_set_required_string || typeof target_settings_set_required_string !== "string") {
      throw new Error("target_settings_set_required_string is required and must be a string");
    }
    if (value_required_text === undefined || value_required_text === null) {
      throw new Error("value_required_text is required");
    }

    const castedSettingsSet = castAndEscape(target_settings_set_required_string, 'string');
    const castedValue = castAndEscape(value_required_text, 'text');
    // Determine value format for AppleScript
    let valueForScript;
    if (typeof castedValue === 'string' && !castedValue.startsWith('{') && !castedValue.startsWith('date')) {
      valueForScript = `"${castedValue}"`; // Wrap strings in quotes
    } else {
      valueForScript = castedValue; // Use as-is for numbers, booleans, lists, records
    }

    const script = `
      tell application "Terminal"
        tell ${castedSettingsSet}
          set name of it to ${valueForScript}
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      message: "Property set successfully",
      value: value_required_text,
      script: script,
      settings_set: target_settings_set_required_string
    };
  }

  async getNumberOfRowsOfSettingsSet(target_settings_set_required_string) {
    if (!target_settings_set_required_string || typeof target_settings_set_required_string !== "string") {
      throw new Error("target_settings_set_required_string is required and must be a string");
    }

    const escapedSettingsSet = escapeForAppleScript(target_settings_set_required_string);

    const script = `
      tell application "Terminal"
        tell ${escapedSettingsSet}
          return number of rows of it
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      value: result,
      script: script,
      settings_set: target_settings_set_required_string
    };
  }

  async setNumberOfRowsOfSettingsSet(target_settings_set_required_string, value_required_integer) {
    if (!target_settings_set_required_string || typeof target_settings_set_required_string !== "string") {
      throw new Error("target_settings_set_required_string is required and must be a string");
    }
    if (value_required_integer === undefined || value_required_integer === null) {
      throw new Error("value_required_integer is required");
    }

    const castedSettingsSet = castAndEscape(target_settings_set_required_string, 'string');
    const castedValue = castAndEscape(value_required_integer, 'integer');
    // Determine value format for AppleScript
    let valueForScript;
    if (typeof castedValue === 'string' && !castedValue.startsWith('{') && !castedValue.startsWith('date')) {
      valueForScript = `"${castedValue}"`; // Wrap strings in quotes
    } else {
      valueForScript = castedValue; // Use as-is for numbers, booleans, lists, records
    }

    const script = `
      tell application "Terminal"
        tell ${castedSettingsSet}
          set number of rows of it to ${valueForScript}
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      message: "Property set successfully",
      value: value_required_integer,
      script: script,
      settings_set: target_settings_set_required_string
    };
  }

  async getNumberOfColumnsOfSettingsSet(target_settings_set_required_string) {
    if (!target_settings_set_required_string || typeof target_settings_set_required_string !== "string") {
      throw new Error("target_settings_set_required_string is required and must be a string");
    }

    const escapedSettingsSet = escapeForAppleScript(target_settings_set_required_string);

    const script = `
      tell application "Terminal"
        tell ${escapedSettingsSet}
          return number of columns of it
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      value: result,
      script: script,
      settings_set: target_settings_set_required_string
    };
  }

  async setNumberOfColumnsOfSettingsSet(target_settings_set_required_string, value_required_integer) {
    if (!target_settings_set_required_string || typeof target_settings_set_required_string !== "string") {
      throw new Error("target_settings_set_required_string is required and must be a string");
    }
    if (value_required_integer === undefined || value_required_integer === null) {
      throw new Error("value_required_integer is required");
    }

    const castedSettingsSet = castAndEscape(target_settings_set_required_string, 'string');
    const castedValue = castAndEscape(value_required_integer, 'integer');
    // Determine value format for AppleScript
    let valueForScript;
    if (typeof castedValue === 'string' && !castedValue.startsWith('{') && !castedValue.startsWith('date')) {
      valueForScript = `"${castedValue}"`; // Wrap strings in quotes
    } else {
      valueForScript = castedValue; // Use as-is for numbers, booleans, lists, records
    }

    const script = `
      tell application "Terminal"
        tell ${castedSettingsSet}
          set number of columns of it to ${valueForScript}
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      message: "Property set successfully",
      value: value_required_integer,
      script: script,
      settings_set: target_settings_set_required_string
    };
  }

  async getCursorColorOfSettingsSet(target_settings_set_required_string) {
    if (!target_settings_set_required_string || typeof target_settings_set_required_string !== "string") {
      throw new Error("target_settings_set_required_string is required and must be a string");
    }

    const escapedSettingsSet = escapeForAppleScript(target_settings_set_required_string);

    const script = `
      tell application "Terminal"
        tell ${escapedSettingsSet}
          return cursor color of it
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      value: result,
      script: script,
      settings_set: target_settings_set_required_string
    };
  }

  async setCursorColorOfSettingsSet(target_settings_set_required_string, value_required_color) {
    if (!target_settings_set_required_string || typeof target_settings_set_required_string !== "string") {
      throw new Error("target_settings_set_required_string is required and must be a string");
    }
    if (value_required_color === undefined || value_required_color === null) {
      throw new Error("value_required_color is required");
    }

    const castedSettingsSet = castAndEscape(target_settings_set_required_string, 'string');
    const castedValue = castAndEscape(value_required_color, 'color');
    // Determine value format for AppleScript
    let valueForScript;
    if (typeof castedValue === 'string' && !castedValue.startsWith('{') && !castedValue.startsWith('date')) {
      valueForScript = `"${castedValue}"`; // Wrap strings in quotes
    } else {
      valueForScript = castedValue; // Use as-is for numbers, booleans, lists, records
    }

    const script = `
      tell application "Terminal"
        tell ${castedSettingsSet}
          set cursor color of it to ${valueForScript}
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      message: "Property set successfully",
      value: value_required_color,
      script: script,
      settings_set: target_settings_set_required_string
    };
  }

  async getBackgroundColorOfSettingsSet(target_settings_set_required_string) {
    if (!target_settings_set_required_string || typeof target_settings_set_required_string !== "string") {
      throw new Error("target_settings_set_required_string is required and must be a string");
    }

    const escapedSettingsSet = escapeForAppleScript(target_settings_set_required_string);

    const script = `
      tell application "Terminal"
        tell ${escapedSettingsSet}
          return background color of it
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      value: result,
      script: script,
      settings_set: target_settings_set_required_string
    };
  }

  async setBackgroundColorOfSettingsSet(target_settings_set_required_string, value_required_color) {
    if (!target_settings_set_required_string || typeof target_settings_set_required_string !== "string") {
      throw new Error("target_settings_set_required_string is required and must be a string");
    }
    if (value_required_color === undefined || value_required_color === null) {
      throw new Error("value_required_color is required");
    }

    const castedSettingsSet = castAndEscape(target_settings_set_required_string, 'string');
    const castedValue = castAndEscape(value_required_color, 'color');
    // Determine value format for AppleScript
    let valueForScript;
    if (typeof castedValue === 'string' && !castedValue.startsWith('{') && !castedValue.startsWith('date')) {
      valueForScript = `"${castedValue}"`; // Wrap strings in quotes
    } else {
      valueForScript = castedValue; // Use as-is for numbers, booleans, lists, records
    }

    const script = `
      tell application "Terminal"
        tell ${castedSettingsSet}
          set background color of it to ${valueForScript}
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      message: "Property set successfully",
      value: value_required_color,
      script: script,
      settings_set: target_settings_set_required_string
    };
  }

  async getNormalTextColorOfSettingsSet(target_settings_set_required_string) {
    if (!target_settings_set_required_string || typeof target_settings_set_required_string !== "string") {
      throw new Error("target_settings_set_required_string is required and must be a string");
    }

    const escapedSettingsSet = escapeForAppleScript(target_settings_set_required_string);

    const script = `
      tell application "Terminal"
        tell ${escapedSettingsSet}
          return normal text color of it
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      value: result,
      script: script,
      settings_set: target_settings_set_required_string
    };
  }

  async setNormalTextColorOfSettingsSet(target_settings_set_required_string, value_required_color) {
    if (!target_settings_set_required_string || typeof target_settings_set_required_string !== "string") {
      throw new Error("target_settings_set_required_string is required and must be a string");
    }
    if (value_required_color === undefined || value_required_color === null) {
      throw new Error("value_required_color is required");
    }

    const castedSettingsSet = castAndEscape(target_settings_set_required_string, 'string');
    const castedValue = castAndEscape(value_required_color, 'color');
    // Determine value format for AppleScript
    let valueForScript;
    if (typeof castedValue === 'string' && !castedValue.startsWith('{') && !castedValue.startsWith('date')) {
      valueForScript = `"${castedValue}"`; // Wrap strings in quotes
    } else {
      valueForScript = castedValue; // Use as-is for numbers, booleans, lists, records
    }

    const script = `
      tell application "Terminal"
        tell ${castedSettingsSet}
          set normal text color of it to ${valueForScript}
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      message: "Property set successfully",
      value: value_required_color,
      script: script,
      settings_set: target_settings_set_required_string
    };
  }

  async getBoldTextColorOfSettingsSet(target_settings_set_required_string) {
    if (!target_settings_set_required_string || typeof target_settings_set_required_string !== "string") {
      throw new Error("target_settings_set_required_string is required and must be a string");
    }

    const escapedSettingsSet = escapeForAppleScript(target_settings_set_required_string);

    const script = `
      tell application "Terminal"
        tell ${escapedSettingsSet}
          return bold text color of it
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      value: result,
      script: script,
      settings_set: target_settings_set_required_string
    };
  }

  async setBoldTextColorOfSettingsSet(target_settings_set_required_string, value_required_color) {
    if (!target_settings_set_required_string || typeof target_settings_set_required_string !== "string") {
      throw new Error("target_settings_set_required_string is required and must be a string");
    }
    if (value_required_color === undefined || value_required_color === null) {
      throw new Error("value_required_color is required");
    }

    const castedSettingsSet = castAndEscape(target_settings_set_required_string, 'string');
    const castedValue = castAndEscape(value_required_color, 'color');
    // Determine value format for AppleScript
    let valueForScript;
    if (typeof castedValue === 'string' && !castedValue.startsWith('{') && !castedValue.startsWith('date')) {
      valueForScript = `"${castedValue}"`; // Wrap strings in quotes
    } else {
      valueForScript = castedValue; // Use as-is for numbers, booleans, lists, records
    }

    const script = `
      tell application "Terminal"
        tell ${castedSettingsSet}
          set bold text color of it to ${valueForScript}
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      message: "Property set successfully",
      value: value_required_color,
      script: script,
      settings_set: target_settings_set_required_string
    };
  }

  async getFontNameOfSettingsSet(target_settings_set_required_string) {
    if (!target_settings_set_required_string || typeof target_settings_set_required_string !== "string") {
      throw new Error("target_settings_set_required_string is required and must be a string");
    }

    const escapedSettingsSet = escapeForAppleScript(target_settings_set_required_string);

    const script = `
      tell application "Terminal"
        tell ${escapedSettingsSet}
          return font name of it
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      value: result,
      script: script,
      settings_set: target_settings_set_required_string
    };
  }

  async setFontNameOfSettingsSet(target_settings_set_required_string, value_required_text) {
    if (!target_settings_set_required_string || typeof target_settings_set_required_string !== "string") {
      throw new Error("target_settings_set_required_string is required and must be a string");
    }
    if (value_required_text === undefined || value_required_text === null) {
      throw new Error("value_required_text is required");
    }

    const castedSettingsSet = castAndEscape(target_settings_set_required_string, 'string');
    const castedValue = castAndEscape(value_required_text, 'text');
    // Determine value format for AppleScript
    let valueForScript;
    if (typeof castedValue === 'string' && !castedValue.startsWith('{') && !castedValue.startsWith('date')) {
      valueForScript = `"${castedValue}"`; // Wrap strings in quotes
    } else {
      valueForScript = castedValue; // Use as-is for numbers, booleans, lists, records
    }

    const script = `
      tell application "Terminal"
        tell ${castedSettingsSet}
          set font name of it to ${valueForScript}
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      message: "Property set successfully",
      value: value_required_text,
      script: script,
      settings_set: target_settings_set_required_string
    };
  }

  async getFontSizeOfSettingsSet(target_settings_set_required_string) {
    if (!target_settings_set_required_string || typeof target_settings_set_required_string !== "string") {
      throw new Error("target_settings_set_required_string is required and must be a string");
    }

    const escapedSettingsSet = escapeForAppleScript(target_settings_set_required_string);

    const script = `
      tell application "Terminal"
        tell ${escapedSettingsSet}
          return font size of it
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      value: result,
      script: script,
      settings_set: target_settings_set_required_string
    };
  }

  async setFontSizeOfSettingsSet(target_settings_set_required_string, value_required_integer) {
    if (!target_settings_set_required_string || typeof target_settings_set_required_string !== "string") {
      throw new Error("target_settings_set_required_string is required and must be a string");
    }
    if (value_required_integer === undefined || value_required_integer === null) {
      throw new Error("value_required_integer is required");
    }

    const castedSettingsSet = castAndEscape(target_settings_set_required_string, 'string');
    const castedValue = castAndEscape(value_required_integer, 'integer');
    // Determine value format for AppleScript
    let valueForScript;
    if (typeof castedValue === 'string' && !castedValue.startsWith('{') && !castedValue.startsWith('date')) {
      valueForScript = `"${castedValue}"`; // Wrap strings in quotes
    } else {
      valueForScript = castedValue; // Use as-is for numbers, booleans, lists, records
    }

    const script = `
      tell application "Terminal"
        tell ${castedSettingsSet}
          set font size of it to ${valueForScript}
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      message: "Property set successfully",
      value: value_required_integer,
      script: script,
      settings_set: target_settings_set_required_string
    };
  }

  async getFontAntialiasingOfSettingsSet(target_settings_set_required_string) {
    if (!target_settings_set_required_string || typeof target_settings_set_required_string !== "string") {
      throw new Error("target_settings_set_required_string is required and must be a string");
    }

    const escapedSettingsSet = escapeForAppleScript(target_settings_set_required_string);

    const script = `
      tell application "Terminal"
        tell ${escapedSettingsSet}
          return font antialiasing of it
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      value: result,
      script: script,
      settings_set: target_settings_set_required_string
    };
  }

  async setFontAntialiasingOfSettingsSet(target_settings_set_required_string, value_required_boolean) {
    if (!target_settings_set_required_string || typeof target_settings_set_required_string !== "string") {
      throw new Error("target_settings_set_required_string is required and must be a string");
    }
    if (value_required_boolean === undefined || value_required_boolean === null) {
      throw new Error("value_required_boolean is required");
    }

    const castedSettingsSet = castAndEscape(target_settings_set_required_string, 'string');
    const castedValue = castAndEscape(value_required_boolean, 'boolean');
    // Determine value format for AppleScript
    let valueForScript;
    if (typeof castedValue === 'string' && !castedValue.startsWith('{') && !castedValue.startsWith('date')) {
      valueForScript = `"${castedValue}"`; // Wrap strings in quotes
    } else {
      valueForScript = castedValue; // Use as-is for numbers, booleans, lists, records
    }

    const script = `
      tell application "Terminal"
        tell ${castedSettingsSet}
          set font antialiasing of it to ${valueForScript}
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      message: "Property set successfully",
      value: value_required_boolean,
      script: script,
      settings_set: target_settings_set_required_string
    };
  }

  async getCleanCommandsOfSettingsSet(target_settings_set_required_string) {
    if (!target_settings_set_required_string || typeof target_settings_set_required_string !== "string") {
      throw new Error("target_settings_set_required_string is required and must be a string");
    }

    const escapedSettingsSet = escapeForAppleScript(target_settings_set_required_string);

    const script = `
      tell application "Terminal"
        tell ${escapedSettingsSet}
          return clean commands of it
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      value: result,
      script: script,
      settings_set: target_settings_set_required_string
    };
  }

  async setCleanCommandsOfSettingsSet(target_settings_set_required_string, value_required_text) {
    if (!target_settings_set_required_string || typeof target_settings_set_required_string !== "string") {
      throw new Error("target_settings_set_required_string is required and must be a string");
    }
    if (value_required_text === undefined || value_required_text === null) {
      throw new Error("value_required_text is required");
    }

    const castedSettingsSet = castAndEscape(target_settings_set_required_string, 'string');
    const castedValue = castAndEscape(value_required_text, 'text');
    // Determine value format for AppleScript
    let valueForScript;
    if (typeof castedValue === 'string' && !castedValue.startsWith('{') && !castedValue.startsWith('date')) {
      valueForScript = `"${castedValue}"`; // Wrap strings in quotes
    } else {
      valueForScript = castedValue; // Use as-is for numbers, booleans, lists, records
    }

    const script = `
      tell application "Terminal"
        tell ${castedSettingsSet}
          set clean commands of it to ${valueForScript}
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      message: "Property set successfully",
      value: value_required_text,
      script: script,
      settings_set: target_settings_set_required_string
    };
  }

  async getTitleDisplaysDeviceNameOfSettingsSet(target_settings_set_required_string) {
    if (!target_settings_set_required_string || typeof target_settings_set_required_string !== "string") {
      throw new Error("target_settings_set_required_string is required and must be a string");
    }

    const escapedSettingsSet = escapeForAppleScript(target_settings_set_required_string);

    const script = `
      tell application "Terminal"
        tell ${escapedSettingsSet}
          return title displays device name of it
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      value: result,
      script: script,
      settings_set: target_settings_set_required_string
    };
  }

  async setTitleDisplaysDeviceNameOfSettingsSet(target_settings_set_required_string, value_required_boolean) {
    if (!target_settings_set_required_string || typeof target_settings_set_required_string !== "string") {
      throw new Error("target_settings_set_required_string is required and must be a string");
    }
    if (value_required_boolean === undefined || value_required_boolean === null) {
      throw new Error("value_required_boolean is required");
    }

    const castedSettingsSet = castAndEscape(target_settings_set_required_string, 'string');
    const castedValue = castAndEscape(value_required_boolean, 'boolean');
    // Determine value format for AppleScript
    let valueForScript;
    if (typeof castedValue === 'string' && !castedValue.startsWith('{') && !castedValue.startsWith('date')) {
      valueForScript = `"${castedValue}"`; // Wrap strings in quotes
    } else {
      valueForScript = castedValue; // Use as-is for numbers, booleans, lists, records
    }

    const script = `
      tell application "Terminal"
        tell ${castedSettingsSet}
          set title displays device name of it to ${valueForScript}
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      message: "Property set successfully",
      value: value_required_boolean,
      script: script,
      settings_set: target_settings_set_required_string
    };
  }

  async getTitleDisplaysShellPathOfSettingsSet(target_settings_set_required_string) {
    if (!target_settings_set_required_string || typeof target_settings_set_required_string !== "string") {
      throw new Error("target_settings_set_required_string is required and must be a string");
    }

    const escapedSettingsSet = escapeForAppleScript(target_settings_set_required_string);

    const script = `
      tell application "Terminal"
        tell ${escapedSettingsSet}
          return title displays shell path of it
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      value: result,
      script: script,
      settings_set: target_settings_set_required_string
    };
  }

  async setTitleDisplaysShellPathOfSettingsSet(target_settings_set_required_string, value_required_boolean) {
    if (!target_settings_set_required_string || typeof target_settings_set_required_string !== "string") {
      throw new Error("target_settings_set_required_string is required and must be a string");
    }
    if (value_required_boolean === undefined || value_required_boolean === null) {
      throw new Error("value_required_boolean is required");
    }

    const castedSettingsSet = castAndEscape(target_settings_set_required_string, 'string');
    const castedValue = castAndEscape(value_required_boolean, 'boolean');
    // Determine value format for AppleScript
    let valueForScript;
    if (typeof castedValue === 'string' && !castedValue.startsWith('{') && !castedValue.startsWith('date')) {
      valueForScript = `"${castedValue}"`; // Wrap strings in quotes
    } else {
      valueForScript = castedValue; // Use as-is for numbers, booleans, lists, records
    }

    const script = `
      tell application "Terminal"
        tell ${castedSettingsSet}
          set title displays shell path of it to ${valueForScript}
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      message: "Property set successfully",
      value: value_required_boolean,
      script: script,
      settings_set: target_settings_set_required_string
    };
  }

  async getTitleDisplaysWindowSizeOfSettingsSet(target_settings_set_required_string) {
    if (!target_settings_set_required_string || typeof target_settings_set_required_string !== "string") {
      throw new Error("target_settings_set_required_string is required and must be a string");
    }

    const escapedSettingsSet = escapeForAppleScript(target_settings_set_required_string);

    const script = `
      tell application "Terminal"
        tell ${escapedSettingsSet}
          return title displays window size of it
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      value: result,
      script: script,
      settings_set: target_settings_set_required_string
    };
  }

  async setTitleDisplaysWindowSizeOfSettingsSet(target_settings_set_required_string, value_required_boolean) {
    if (!target_settings_set_required_string || typeof target_settings_set_required_string !== "string") {
      throw new Error("target_settings_set_required_string is required and must be a string");
    }
    if (value_required_boolean === undefined || value_required_boolean === null) {
      throw new Error("value_required_boolean is required");
    }

    const castedSettingsSet = castAndEscape(target_settings_set_required_string, 'string');
    const castedValue = castAndEscape(value_required_boolean, 'boolean');
    // Determine value format for AppleScript
    let valueForScript;
    if (typeof castedValue === 'string' && !castedValue.startsWith('{') && !castedValue.startsWith('date')) {
      valueForScript = `"${castedValue}"`; // Wrap strings in quotes
    } else {
      valueForScript = castedValue; // Use as-is for numbers, booleans, lists, records
    }

    const script = `
      tell application "Terminal"
        tell ${castedSettingsSet}
          set title displays window size of it to ${valueForScript}
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      message: "Property set successfully",
      value: value_required_boolean,
      script: script,
      settings_set: target_settings_set_required_string
    };
  }

  async getTitleDisplaysSettingsNameOfSettingsSet(target_settings_set_required_string) {
    if (!target_settings_set_required_string || typeof target_settings_set_required_string !== "string") {
      throw new Error("target_settings_set_required_string is required and must be a string");
    }

    const escapedSettingsSet = escapeForAppleScript(target_settings_set_required_string);

    const script = `
      tell application "Terminal"
        tell ${escapedSettingsSet}
          return title displays settings name of it
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      value: result,
      script: script,
      settings_set: target_settings_set_required_string
    };
  }

  async setTitleDisplaysSettingsNameOfSettingsSet(target_settings_set_required_string, value_required_boolean) {
    if (!target_settings_set_required_string || typeof target_settings_set_required_string !== "string") {
      throw new Error("target_settings_set_required_string is required and must be a string");
    }
    if (value_required_boolean === undefined || value_required_boolean === null) {
      throw new Error("value_required_boolean is required");
    }

    const castedSettingsSet = castAndEscape(target_settings_set_required_string, 'string');
    const castedValue = castAndEscape(value_required_boolean, 'boolean');
    // Determine value format for AppleScript
    let valueForScript;
    if (typeof castedValue === 'string' && !castedValue.startsWith('{') && !castedValue.startsWith('date')) {
      valueForScript = `"${castedValue}"`; // Wrap strings in quotes
    } else {
      valueForScript = castedValue; // Use as-is for numbers, booleans, lists, records
    }

    const script = `
      tell application "Terminal"
        tell ${castedSettingsSet}
          set title displays settings name of it to ${valueForScript}
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      message: "Property set successfully",
      value: value_required_boolean,
      script: script,
      settings_set: target_settings_set_required_string
    };
  }

  async getTitleDisplaysCustomTitleOfSettingsSet(target_settings_set_required_string) {
    if (!target_settings_set_required_string || typeof target_settings_set_required_string !== "string") {
      throw new Error("target_settings_set_required_string is required and must be a string");
    }

    const escapedSettingsSet = escapeForAppleScript(target_settings_set_required_string);

    const script = `
      tell application "Terminal"
        tell ${escapedSettingsSet}
          return title displays custom title of it
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      value: result,
      script: script,
      settings_set: target_settings_set_required_string
    };
  }

  async setTitleDisplaysCustomTitleOfSettingsSet(target_settings_set_required_string, value_required_boolean) {
    if (!target_settings_set_required_string || typeof target_settings_set_required_string !== "string") {
      throw new Error("target_settings_set_required_string is required and must be a string");
    }
    if (value_required_boolean === undefined || value_required_boolean === null) {
      throw new Error("value_required_boolean is required");
    }

    const castedSettingsSet = castAndEscape(target_settings_set_required_string, 'string');
    const castedValue = castAndEscape(value_required_boolean, 'boolean');
    // Determine value format for AppleScript
    let valueForScript;
    if (typeof castedValue === 'string' && !castedValue.startsWith('{') && !castedValue.startsWith('date')) {
      valueForScript = `"${castedValue}"`; // Wrap strings in quotes
    } else {
      valueForScript = castedValue; // Use as-is for numbers, booleans, lists, records
    }

    const script = `
      tell application "Terminal"
        tell ${castedSettingsSet}
          set title displays custom title of it to ${valueForScript}
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      message: "Property set successfully",
      value: value_required_boolean,
      script: script,
      settings_set: target_settings_set_required_string
    };
  }

  async getCustomTitleOfSettingsSet(target_settings_set_required_string) {
    if (!target_settings_set_required_string || typeof target_settings_set_required_string !== "string") {
      throw new Error("target_settings_set_required_string is required and must be a string");
    }

    const escapedSettingsSet = escapeForAppleScript(target_settings_set_required_string);

    const script = `
      tell application "Terminal"
        tell ${escapedSettingsSet}
          return custom title of it
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      value: result,
      script: script,
      settings_set: target_settings_set_required_string
    };
  }

  async setCustomTitleOfSettingsSet(target_settings_set_required_string, value_required_text) {
    if (!target_settings_set_required_string || typeof target_settings_set_required_string !== "string") {
      throw new Error("target_settings_set_required_string is required and must be a string");
    }
    if (value_required_text === undefined || value_required_text === null) {
      throw new Error("value_required_text is required");
    }

    const castedSettingsSet = castAndEscape(target_settings_set_required_string, 'string');
    const castedValue = castAndEscape(value_required_text, 'text');
    // Determine value format for AppleScript
    let valueForScript;
    if (typeof castedValue === 'string' && !castedValue.startsWith('{') && !castedValue.startsWith('date')) {
      valueForScript = `"${castedValue}"`; // Wrap strings in quotes
    } else {
      valueForScript = castedValue; // Use as-is for numbers, booleans, lists, records
    }

    const script = `
      tell application "Terminal"
        tell ${castedSettingsSet}
          set custom title of it to ${valueForScript}
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      message: "Property set successfully",
      value: value_required_text,
      script: script,
      settings_set: target_settings_set_required_string
    };
  }

  async getNumberOfRowsOfTabOfWindow(target_tab_required_string, target_window_required_string) {
    if (!target_tab_required_string || typeof target_tab_required_string !== "string") {
      throw new Error("target_tab_required_string is required and must be a string");
    }
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }

    const escapedTab = escapeForAppleScript(target_tab_required_string);
    const escapedWindow = escapeForAppleScript(target_window_required_string);

    const script = `
      tell application "Terminal"
        tell (${escapedTab} of ${escapedWindow})
          return number of rows of it
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      value: result,
      script: script,
      tab: target_tab_required_string,
      window: target_window_required_string
    };
  }

  async setNumberOfRowsOfTabOfWindow(target_tab_required_string, target_window_required_string, value_required_integer) {
    if (!target_tab_required_string || typeof target_tab_required_string !== "string") {
      throw new Error("target_tab_required_string is required and must be a string");
    }
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }
    if (value_required_integer === undefined || value_required_integer === null) {
      throw new Error("value_required_integer is required");
    }

    const castedTab = castAndEscape(target_tab_required_string, 'string');
    const castedWindow = castAndEscape(target_window_required_string, 'string');
    const castedValue = castAndEscape(value_required_integer, 'integer');
    // Determine value format for AppleScript
    let valueForScript;
    if (typeof castedValue === 'string' && !castedValue.startsWith('{') && !castedValue.startsWith('date')) {
      valueForScript = `"${castedValue}"`; // Wrap strings in quotes
    } else {
      valueForScript = castedValue; // Use as-is for numbers, booleans, lists, records
    }

    const script = `
      tell application "Terminal"
        tell (${castedTab} of ${castedWindow})
          set number of rows of it to ${valueForScript}
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      message: "Property set successfully",
      value: value_required_integer,
      script: script,
      tab: target_tab_required_string,
      window: target_window_required_string
    };
  }

  async getNumberOfColumnsOfTabOfWindow(target_tab_required_string, target_window_required_string) {
    if (!target_tab_required_string || typeof target_tab_required_string !== "string") {
      throw new Error("target_tab_required_string is required and must be a string");
    }
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }

    const escapedTab = escapeForAppleScript(target_tab_required_string);
    const escapedWindow = escapeForAppleScript(target_window_required_string);

    const script = `
      tell application "Terminal"
        tell (${escapedTab} of ${escapedWindow})
          return number of columns of it
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      value: result,
      script: script,
      tab: target_tab_required_string,
      window: target_window_required_string
    };
  }

  async setNumberOfColumnsOfTabOfWindow(target_tab_required_string, target_window_required_string, value_required_integer) {
    if (!target_tab_required_string || typeof target_tab_required_string !== "string") {
      throw new Error("target_tab_required_string is required and must be a string");
    }
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }
    if (value_required_integer === undefined || value_required_integer === null) {
      throw new Error("value_required_integer is required");
    }

    const castedTab = castAndEscape(target_tab_required_string, 'string');
    const castedWindow = castAndEscape(target_window_required_string, 'string');
    const castedValue = castAndEscape(value_required_integer, 'integer');
    // Determine value format for AppleScript
    let valueForScript;
    if (typeof castedValue === 'string' && !castedValue.startsWith('{') && !castedValue.startsWith('date')) {
      valueForScript = `"${castedValue}"`; // Wrap strings in quotes
    } else {
      valueForScript = castedValue; // Use as-is for numbers, booleans, lists, records
    }

    const script = `
      tell application "Terminal"
        tell (${castedTab} of ${castedWindow})
          set number of columns of it to ${valueForScript}
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      message: "Property set successfully",
      value: value_required_integer,
      script: script,
      tab: target_tab_required_string,
      window: target_window_required_string
    };
  }

  async getContentsOfTabOfWindow(target_tab_required_string, target_window_required_string) {
    if (!target_tab_required_string || typeof target_tab_required_string !== "string") {
      throw new Error("target_tab_required_string is required and must be a string");
    }
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }

    const escapedTab = escapeForAppleScript(target_tab_required_string);
    const escapedWindow = escapeForAppleScript(target_window_required_string);

    const script = `
      tell application "Terminal"
        tell (${escapedTab} of ${escapedWindow})
          return contents of it
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      value: result,
      script: script,
      tab: target_tab_required_string,
      window: target_window_required_string
    };
  }

  async getHistoryOfTabOfWindow(target_tab_required_string, target_window_required_string) {
    if (!target_tab_required_string || typeof target_tab_required_string !== "string") {
      throw new Error("target_tab_required_string is required and must be a string");
    }
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }

    const escapedTab = escapeForAppleScript(target_tab_required_string);
    const escapedWindow = escapeForAppleScript(target_window_required_string);

    const script = `
      tell application "Terminal"
        tell (${escapedTab} of ${escapedWindow})
          return history of it
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      value: result,
      script: script,
      tab: target_tab_required_string,
      window: target_window_required_string
    };
  }

  async getBusyOfTabOfWindow(target_tab_required_string, target_window_required_string) {
    if (!target_tab_required_string || typeof target_tab_required_string !== "string") {
      throw new Error("target_tab_required_string is required and must be a string");
    }
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }

    const escapedTab = escapeForAppleScript(target_tab_required_string);
    const escapedWindow = escapeForAppleScript(target_window_required_string);

    const script = `
      tell application "Terminal"
        tell (${escapedTab} of ${escapedWindow})
          return busy of it
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      value: result,
      script: script,
      tab: target_tab_required_string,
      window: target_window_required_string
    };
  }

  async getProcessesOfTabOfWindow(target_tab_required_string, target_window_required_string) {
    if (!target_tab_required_string || typeof target_tab_required_string !== "string") {
      throw new Error("target_tab_required_string is required and must be a string");
    }
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }

    const escapedTab = escapeForAppleScript(target_tab_required_string);
    const escapedWindow = escapeForAppleScript(target_window_required_string);

    const script = `
      tell application "Terminal"
        tell (${escapedTab} of ${escapedWindow})
          return processes of it
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      value: result,
      script: script,
      tab: target_tab_required_string,
      window: target_window_required_string
    };
  }

  async getSelectedOfTabOfWindow(target_tab_required_string, target_window_required_string) {
    if (!target_tab_required_string || typeof target_tab_required_string !== "string") {
      throw new Error("target_tab_required_string is required and must be a string");
    }
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }

    const escapedTab = escapeForAppleScript(target_tab_required_string);
    const escapedWindow = escapeForAppleScript(target_window_required_string);

    const script = `
      tell application "Terminal"
        tell (${escapedTab} of ${escapedWindow})
          return selected of it
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      value: result,
      script: script,
      tab: target_tab_required_string,
      window: target_window_required_string
    };
  }

  async setSelectedOfTabOfWindow(target_tab_required_string, target_window_required_string, value_required_boolean) {
    if (!target_tab_required_string || typeof target_tab_required_string !== "string") {
      throw new Error("target_tab_required_string is required and must be a string");
    }
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }
    if (value_required_boolean === undefined || value_required_boolean === null) {
      throw new Error("value_required_boolean is required");
    }

    const castedTab = castAndEscape(target_tab_required_string, 'string');
    const castedWindow = castAndEscape(target_window_required_string, 'string');
    const castedValue = castAndEscape(value_required_boolean, 'boolean');
    // Determine value format for AppleScript
    let valueForScript;
    if (typeof castedValue === 'string' && !castedValue.startsWith('{') && !castedValue.startsWith('date')) {
      valueForScript = `"${castedValue}"`; // Wrap strings in quotes
    } else {
      valueForScript = castedValue; // Use as-is for numbers, booleans, lists, records
    }

    const script = `
      tell application "Terminal"
        tell (${castedTab} of ${castedWindow})
          set selected of it to ${valueForScript}
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      message: "Property set successfully",
      value: value_required_boolean,
      script: script,
      tab: target_tab_required_string,
      window: target_window_required_string
    };
  }

  async getTitleDisplaysCustomTitleOfTabOfWindow(target_tab_required_string, target_window_required_string) {
    if (!target_tab_required_string || typeof target_tab_required_string !== "string") {
      throw new Error("target_tab_required_string is required and must be a string");
    }
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }

    const escapedTab = escapeForAppleScript(target_tab_required_string);
    const escapedWindow = escapeForAppleScript(target_window_required_string);

    const script = `
      tell application "Terminal"
        tell (${escapedTab} of ${escapedWindow})
          return title displays custom title of it
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      value: result,
      script: script,
      tab: target_tab_required_string,
      window: target_window_required_string
    };
  }

  async setTitleDisplaysCustomTitleOfTabOfWindow(target_tab_required_string, target_window_required_string, value_required_boolean) {
    if (!target_tab_required_string || typeof target_tab_required_string !== "string") {
      throw new Error("target_tab_required_string is required and must be a string");
    }
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }
    if (value_required_boolean === undefined || value_required_boolean === null) {
      throw new Error("value_required_boolean is required");
    }

    const castedTab = castAndEscape(target_tab_required_string, 'string');
    const castedWindow = castAndEscape(target_window_required_string, 'string');
    const castedValue = castAndEscape(value_required_boolean, 'boolean');
    // Determine value format for AppleScript
    let valueForScript;
    if (typeof castedValue === 'string' && !castedValue.startsWith('{') && !castedValue.startsWith('date')) {
      valueForScript = `"${castedValue}"`; // Wrap strings in quotes
    } else {
      valueForScript = castedValue; // Use as-is for numbers, booleans, lists, records
    }

    const script = `
      tell application "Terminal"
        tell (${castedTab} of ${castedWindow})
          set title displays custom title of it to ${valueForScript}
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      message: "Property set successfully",
      value: value_required_boolean,
      script: script,
      tab: target_tab_required_string,
      window: target_window_required_string
    };
  }

  async getCustomTitleOfTabOfWindow(target_tab_required_string, target_window_required_string) {
    if (!target_tab_required_string || typeof target_tab_required_string !== "string") {
      throw new Error("target_tab_required_string is required and must be a string");
    }
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }

    const escapedTab = escapeForAppleScript(target_tab_required_string);
    const escapedWindow = escapeForAppleScript(target_window_required_string);

    const script = `
      tell application "Terminal"
        tell (${escapedTab} of ${escapedWindow})
          return custom title of it
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      value: result,
      script: script,
      tab: target_tab_required_string,
      window: target_window_required_string
    };
  }

  async setCustomTitleOfTabOfWindow(target_tab_required_string, target_window_required_string, value_required_text) {
    if (!target_tab_required_string || typeof target_tab_required_string !== "string") {
      throw new Error("target_tab_required_string is required and must be a string");
    }
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }
    if (value_required_text === undefined || value_required_text === null) {
      throw new Error("value_required_text is required");
    }

    const castedTab = castAndEscape(target_tab_required_string, 'string');
    const castedWindow = castAndEscape(target_window_required_string, 'string');
    const castedValue = castAndEscape(value_required_text, 'text');
    // Determine value format for AppleScript
    let valueForScript;
    if (typeof castedValue === 'string' && !castedValue.startsWith('{') && !castedValue.startsWith('date')) {
      valueForScript = `"${castedValue}"`; // Wrap strings in quotes
    } else {
      valueForScript = castedValue; // Use as-is for numbers, booleans, lists, records
    }

    const script = `
      tell application "Terminal"
        tell (${castedTab} of ${castedWindow})
          set custom title of it to ${valueForScript}
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      message: "Property set successfully",
      value: value_required_text,
      script: script,
      tab: target_tab_required_string,
      window: target_window_required_string
    };
  }

  async getTtyOfTabOfWindow(target_tab_required_string, target_window_required_string) {
    if (!target_tab_required_string || typeof target_tab_required_string !== "string") {
      throw new Error("target_tab_required_string is required and must be a string");
    }
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }

    const escapedTab = escapeForAppleScript(target_tab_required_string);
    const escapedWindow = escapeForAppleScript(target_window_required_string);

    const script = `
      tell application "Terminal"
        tell (${escapedTab} of ${escapedWindow})
          return tty of it
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      value: result,
      script: script,
      tab: target_tab_required_string,
      window: target_window_required_string
    };
  }

  async getCurrentSettingsOfTabOfWindow(target_tab_required_string, target_window_required_string) {
    if (!target_tab_required_string || typeof target_tab_required_string !== "string") {
      throw new Error("target_tab_required_string is required and must be a string");
    }
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }

    const escapedTab = escapeForAppleScript(target_tab_required_string);
    const escapedWindow = escapeForAppleScript(target_window_required_string);

    const script = `
      tell application "Terminal"
        tell (${escapedTab} of ${escapedWindow})
          return current settings of it
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      value: result,
      script: script,
      tab: target_tab_required_string,
      window: target_window_required_string
    };
  }

  async setCurrentSettingsOfTabOfWindow(target_tab_required_string, target_window_required_string, value_required_settings_set) {
    if (!target_tab_required_string || typeof target_tab_required_string !== "string") {
      throw new Error("target_tab_required_string is required and must be a string");
    }
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }
    if (value_required_settings_set === undefined || value_required_settings_set === null) {
      throw new Error("value_required_settings_set is required");
    }

    const castedTab = castAndEscape(target_tab_required_string, 'string');
    const castedWindow = castAndEscape(target_window_required_string, 'string');
    const castedValue = castAndEscape(value_required_settings_set, 'settings set');
    // Determine value format for AppleScript
    let valueForScript;
    // Property type 'settings set' is a class reference - treat as object
    valueForScript = castedValue; // Object reference - no quotes

    const script = `
      tell application "Terminal"
        tell (${castedTab} of ${castedWindow})
          set current settings of it to ${valueForScript}
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      message: "Property set successfully",
      value: value_required_settings_set,
      script: script,
      tab: target_tab_required_string,
      window: target_window_required_string
    };
  }

  async getCursorColorOfTabOfWindow(target_tab_required_string, target_window_required_string) {
    if (!target_tab_required_string || typeof target_tab_required_string !== "string") {
      throw new Error("target_tab_required_string is required and must be a string");
    }
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }

    const escapedTab = escapeForAppleScript(target_tab_required_string);
    const escapedWindow = escapeForAppleScript(target_window_required_string);

    const script = `
      tell application "Terminal"
        tell (${escapedTab} of ${escapedWindow})
          return cursor color of it
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      value: result,
      script: script,
      tab: target_tab_required_string,
      window: target_window_required_string
    };
  }

  async setCursorColorOfTabOfWindow(target_tab_required_string, target_window_required_string, value_required_color) {
    if (!target_tab_required_string || typeof target_tab_required_string !== "string") {
      throw new Error("target_tab_required_string is required and must be a string");
    }
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }
    if (value_required_color === undefined || value_required_color === null) {
      throw new Error("value_required_color is required");
    }

    const castedTab = castAndEscape(target_tab_required_string, 'string');
    const castedWindow = castAndEscape(target_window_required_string, 'string');
    const castedValue = castAndEscape(value_required_color, 'color');
    // Determine value format for AppleScript
    let valueForScript;
    if (typeof castedValue === 'string' && !castedValue.startsWith('{') && !castedValue.startsWith('date')) {
      valueForScript = `"${castedValue}"`; // Wrap strings in quotes
    } else {
      valueForScript = castedValue; // Use as-is for numbers, booleans, lists, records
    }

    const script = `
      tell application "Terminal"
        tell (${castedTab} of ${castedWindow})
          set cursor color of it to ${valueForScript}
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      message: "Property set successfully",
      value: value_required_color,
      script: script,
      tab: target_tab_required_string,
      window: target_window_required_string
    };
  }

  async getBackgroundColorOfTabOfWindow(target_tab_required_string, target_window_required_string) {
    if (!target_tab_required_string || typeof target_tab_required_string !== "string") {
      throw new Error("target_tab_required_string is required and must be a string");
    }
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }

    const escapedTab = escapeForAppleScript(target_tab_required_string);
    const escapedWindow = escapeForAppleScript(target_window_required_string);

    const script = `
      tell application "Terminal"
        tell (${escapedTab} of ${escapedWindow})
          return background color of it
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      value: result,
      script: script,
      tab: target_tab_required_string,
      window: target_window_required_string
    };
  }

  async setBackgroundColorOfTabOfWindow(target_tab_required_string, target_window_required_string, value_required_color) {
    if (!target_tab_required_string || typeof target_tab_required_string !== "string") {
      throw new Error("target_tab_required_string is required and must be a string");
    }
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }
    if (value_required_color === undefined || value_required_color === null) {
      throw new Error("value_required_color is required");
    }

    const castedTab = castAndEscape(target_tab_required_string, 'string');
    const castedWindow = castAndEscape(target_window_required_string, 'string');
    const castedValue = castAndEscape(value_required_color, 'color');
    // Determine value format for AppleScript
    let valueForScript;
    if (typeof castedValue === 'string' && !castedValue.startsWith('{') && !castedValue.startsWith('date')) {
      valueForScript = `"${castedValue}"`; // Wrap strings in quotes
    } else {
      valueForScript = castedValue; // Use as-is for numbers, booleans, lists, records
    }

    const script = `
      tell application "Terminal"
        tell (${castedTab} of ${castedWindow})
          set background color of it to ${valueForScript}
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      message: "Property set successfully",
      value: value_required_color,
      script: script,
      tab: target_tab_required_string,
      window: target_window_required_string
    };
  }

  async getNormalTextColorOfTabOfWindow(target_tab_required_string, target_window_required_string) {
    if (!target_tab_required_string || typeof target_tab_required_string !== "string") {
      throw new Error("target_tab_required_string is required and must be a string");
    }
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }

    const escapedTab = escapeForAppleScript(target_tab_required_string);
    const escapedWindow = escapeForAppleScript(target_window_required_string);

    const script = `
      tell application "Terminal"
        tell (${escapedTab} of ${escapedWindow})
          return normal text color of it
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      value: result,
      script: script,
      tab: target_tab_required_string,
      window: target_window_required_string
    };
  }

  async setNormalTextColorOfTabOfWindow(target_tab_required_string, target_window_required_string, value_required_color) {
    if (!target_tab_required_string || typeof target_tab_required_string !== "string") {
      throw new Error("target_tab_required_string is required and must be a string");
    }
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }
    if (value_required_color === undefined || value_required_color === null) {
      throw new Error("value_required_color is required");
    }

    const castedTab = castAndEscape(target_tab_required_string, 'string');
    const castedWindow = castAndEscape(target_window_required_string, 'string');
    const castedValue = castAndEscape(value_required_color, 'color');
    // Determine value format for AppleScript
    let valueForScript;
    if (typeof castedValue === 'string' && !castedValue.startsWith('{') && !castedValue.startsWith('date')) {
      valueForScript = `"${castedValue}"`; // Wrap strings in quotes
    } else {
      valueForScript = castedValue; // Use as-is for numbers, booleans, lists, records
    }

    const script = `
      tell application "Terminal"
        tell (${castedTab} of ${castedWindow})
          set normal text color of it to ${valueForScript}
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      message: "Property set successfully",
      value: value_required_color,
      script: script,
      tab: target_tab_required_string,
      window: target_window_required_string
    };
  }

  async getBoldTextColorOfTabOfWindow(target_tab_required_string, target_window_required_string) {
    if (!target_tab_required_string || typeof target_tab_required_string !== "string") {
      throw new Error("target_tab_required_string is required and must be a string");
    }
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }

    const escapedTab = escapeForAppleScript(target_tab_required_string);
    const escapedWindow = escapeForAppleScript(target_window_required_string);

    const script = `
      tell application "Terminal"
        tell (${escapedTab} of ${escapedWindow})
          return bold text color of it
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      value: result,
      script: script,
      tab: target_tab_required_string,
      window: target_window_required_string
    };
  }

  async setBoldTextColorOfTabOfWindow(target_tab_required_string, target_window_required_string, value_required_color) {
    if (!target_tab_required_string || typeof target_tab_required_string !== "string") {
      throw new Error("target_tab_required_string is required and must be a string");
    }
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }
    if (value_required_color === undefined || value_required_color === null) {
      throw new Error("value_required_color is required");
    }

    const castedTab = castAndEscape(target_tab_required_string, 'string');
    const castedWindow = castAndEscape(target_window_required_string, 'string');
    const castedValue = castAndEscape(value_required_color, 'color');
    // Determine value format for AppleScript
    let valueForScript;
    if (typeof castedValue === 'string' && !castedValue.startsWith('{') && !castedValue.startsWith('date')) {
      valueForScript = `"${castedValue}"`; // Wrap strings in quotes
    } else {
      valueForScript = castedValue; // Use as-is for numbers, booleans, lists, records
    }

    const script = `
      tell application "Terminal"
        tell (${castedTab} of ${castedWindow})
          set bold text color of it to ${valueForScript}
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      message: "Property set successfully",
      value: value_required_color,
      script: script,
      tab: target_tab_required_string,
      window: target_window_required_string
    };
  }

  async getCleanCommandsOfTabOfWindow(target_tab_required_string, target_window_required_string) {
    if (!target_tab_required_string || typeof target_tab_required_string !== "string") {
      throw new Error("target_tab_required_string is required and must be a string");
    }
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }

    const escapedTab = escapeForAppleScript(target_tab_required_string);
    const escapedWindow = escapeForAppleScript(target_window_required_string);

    const script = `
      tell application "Terminal"
        tell (${escapedTab} of ${escapedWindow})
          return clean commands of it
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      value: result,
      script: script,
      tab: target_tab_required_string,
      window: target_window_required_string
    };
  }

  async setCleanCommandsOfTabOfWindow(target_tab_required_string, target_window_required_string, value_required_text) {
    if (!target_tab_required_string || typeof target_tab_required_string !== "string") {
      throw new Error("target_tab_required_string is required and must be a string");
    }
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }
    if (value_required_text === undefined || value_required_text === null) {
      throw new Error("value_required_text is required");
    }

    const castedTab = castAndEscape(target_tab_required_string, 'string');
    const castedWindow = castAndEscape(target_window_required_string, 'string');
    const castedValue = castAndEscape(value_required_text, 'text');
    // Determine value format for AppleScript
    let valueForScript;
    if (typeof castedValue === 'string' && !castedValue.startsWith('{') && !castedValue.startsWith('date')) {
      valueForScript = `"${castedValue}"`; // Wrap strings in quotes
    } else {
      valueForScript = castedValue; // Use as-is for numbers, booleans, lists, records
    }

    const script = `
      tell application "Terminal"
        tell (${castedTab} of ${castedWindow})
          set clean commands of it to ${valueForScript}
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      message: "Property set successfully",
      value: value_required_text,
      script: script,
      tab: target_tab_required_string,
      window: target_window_required_string
    };
  }

  async getTitleDisplaysDeviceNameOfTabOfWindow(target_tab_required_string, target_window_required_string) {
    if (!target_tab_required_string || typeof target_tab_required_string !== "string") {
      throw new Error("target_tab_required_string is required and must be a string");
    }
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }

    const escapedTab = escapeForAppleScript(target_tab_required_string);
    const escapedWindow = escapeForAppleScript(target_window_required_string);

    const script = `
      tell application "Terminal"
        tell (${escapedTab} of ${escapedWindow})
          return title displays device name of it
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      value: result,
      script: script,
      tab: target_tab_required_string,
      window: target_window_required_string
    };
  }

  async setTitleDisplaysDeviceNameOfTabOfWindow(target_tab_required_string, target_window_required_string, value_required_boolean) {
    if (!target_tab_required_string || typeof target_tab_required_string !== "string") {
      throw new Error("target_tab_required_string is required and must be a string");
    }
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }
    if (value_required_boolean === undefined || value_required_boolean === null) {
      throw new Error("value_required_boolean is required");
    }

    const castedTab = castAndEscape(target_tab_required_string, 'string');
    const castedWindow = castAndEscape(target_window_required_string, 'string');
    const castedValue = castAndEscape(value_required_boolean, 'boolean');
    // Determine value format for AppleScript
    let valueForScript;
    if (typeof castedValue === 'string' && !castedValue.startsWith('{') && !castedValue.startsWith('date')) {
      valueForScript = `"${castedValue}"`; // Wrap strings in quotes
    } else {
      valueForScript = castedValue; // Use as-is for numbers, booleans, lists, records
    }

    const script = `
      tell application "Terminal"
        tell (${castedTab} of ${castedWindow})
          set title displays device name of it to ${valueForScript}
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      message: "Property set successfully",
      value: value_required_boolean,
      script: script,
      tab: target_tab_required_string,
      window: target_window_required_string
    };
  }

  async getTitleDisplaysShellPathOfTabOfWindow(target_tab_required_string, target_window_required_string) {
    if (!target_tab_required_string || typeof target_tab_required_string !== "string") {
      throw new Error("target_tab_required_string is required and must be a string");
    }
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }

    const escapedTab = escapeForAppleScript(target_tab_required_string);
    const escapedWindow = escapeForAppleScript(target_window_required_string);

    const script = `
      tell application "Terminal"
        tell (${escapedTab} of ${escapedWindow})
          return title displays shell path of it
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      value: result,
      script: script,
      tab: target_tab_required_string,
      window: target_window_required_string
    };
  }

  async setTitleDisplaysShellPathOfTabOfWindow(target_tab_required_string, target_window_required_string, value_required_boolean) {
    if (!target_tab_required_string || typeof target_tab_required_string !== "string") {
      throw new Error("target_tab_required_string is required and must be a string");
    }
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }
    if (value_required_boolean === undefined || value_required_boolean === null) {
      throw new Error("value_required_boolean is required");
    }

    const castedTab = castAndEscape(target_tab_required_string, 'string');
    const castedWindow = castAndEscape(target_window_required_string, 'string');
    const castedValue = castAndEscape(value_required_boolean, 'boolean');
    // Determine value format for AppleScript
    let valueForScript;
    if (typeof castedValue === 'string' && !castedValue.startsWith('{') && !castedValue.startsWith('date')) {
      valueForScript = `"${castedValue}"`; // Wrap strings in quotes
    } else {
      valueForScript = castedValue; // Use as-is for numbers, booleans, lists, records
    }

    const script = `
      tell application "Terminal"
        tell (${castedTab} of ${castedWindow})
          set title displays shell path of it to ${valueForScript}
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      message: "Property set successfully",
      value: value_required_boolean,
      script: script,
      tab: target_tab_required_string,
      window: target_window_required_string
    };
  }

  async getTitleDisplaysWindowSizeOfTabOfWindow(target_tab_required_string, target_window_required_string) {
    if (!target_tab_required_string || typeof target_tab_required_string !== "string") {
      throw new Error("target_tab_required_string is required and must be a string");
    }
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }

    const escapedTab = escapeForAppleScript(target_tab_required_string);
    const escapedWindow = escapeForAppleScript(target_window_required_string);

    const script = `
      tell application "Terminal"
        tell (${escapedTab} of ${escapedWindow})
          return title displays window size of it
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      value: result,
      script: script,
      tab: target_tab_required_string,
      window: target_window_required_string
    };
  }

  async setTitleDisplaysWindowSizeOfTabOfWindow(target_tab_required_string, target_window_required_string, value_required_boolean) {
    if (!target_tab_required_string || typeof target_tab_required_string !== "string") {
      throw new Error("target_tab_required_string is required and must be a string");
    }
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }
    if (value_required_boolean === undefined || value_required_boolean === null) {
      throw new Error("value_required_boolean is required");
    }

    const castedTab = castAndEscape(target_tab_required_string, 'string');
    const castedWindow = castAndEscape(target_window_required_string, 'string');
    const castedValue = castAndEscape(value_required_boolean, 'boolean');
    // Determine value format for AppleScript
    let valueForScript;
    if (typeof castedValue === 'string' && !castedValue.startsWith('{') && !castedValue.startsWith('date')) {
      valueForScript = `"${castedValue}"`; // Wrap strings in quotes
    } else {
      valueForScript = castedValue; // Use as-is for numbers, booleans, lists, records
    }

    const script = `
      tell application "Terminal"
        tell (${castedTab} of ${castedWindow})
          set title displays window size of it to ${valueForScript}
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      message: "Property set successfully",
      value: value_required_boolean,
      script: script,
      tab: target_tab_required_string,
      window: target_window_required_string
    };
  }

  async getTitleDisplaysFileNameOfTabOfWindow(target_tab_required_string, target_window_required_string) {
    if (!target_tab_required_string || typeof target_tab_required_string !== "string") {
      throw new Error("target_tab_required_string is required and must be a string");
    }
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }

    const escapedTab = escapeForAppleScript(target_tab_required_string);
    const escapedWindow = escapeForAppleScript(target_window_required_string);

    const script = `
      tell application "Terminal"
        tell (${escapedTab} of ${escapedWindow})
          return title displays file name of it
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      value: result,
      script: script,
      tab: target_tab_required_string,
      window: target_window_required_string
    };
  }

  async setTitleDisplaysFileNameOfTabOfWindow(target_tab_required_string, target_window_required_string, value_required_boolean) {
    if (!target_tab_required_string || typeof target_tab_required_string !== "string") {
      throw new Error("target_tab_required_string is required and must be a string");
    }
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }
    if (value_required_boolean === undefined || value_required_boolean === null) {
      throw new Error("value_required_boolean is required");
    }

    const castedTab = castAndEscape(target_tab_required_string, 'string');
    const castedWindow = castAndEscape(target_window_required_string, 'string');
    const castedValue = castAndEscape(value_required_boolean, 'boolean');
    // Determine value format for AppleScript
    let valueForScript;
    if (typeof castedValue === 'string' && !castedValue.startsWith('{') && !castedValue.startsWith('date')) {
      valueForScript = `"${castedValue}"`; // Wrap strings in quotes
    } else {
      valueForScript = castedValue; // Use as-is for numbers, booleans, lists, records
    }

    const script = `
      tell application "Terminal"
        tell (${castedTab} of ${castedWindow})
          set title displays file name of it to ${valueForScript}
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      message: "Property set successfully",
      value: value_required_boolean,
      script: script,
      tab: target_tab_required_string,
      window: target_window_required_string
    };
  }

  async getFontNameOfTabOfWindow(target_tab_required_string, target_window_required_string) {
    if (!target_tab_required_string || typeof target_tab_required_string !== "string") {
      throw new Error("target_tab_required_string is required and must be a string");
    }
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }

    const escapedTab = escapeForAppleScript(target_tab_required_string);
    const escapedWindow = escapeForAppleScript(target_window_required_string);

    const script = `
      tell application "Terminal"
        tell (${escapedTab} of ${escapedWindow})
          return font name of it
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      value: result,
      script: script,
      tab: target_tab_required_string,
      window: target_window_required_string
    };
  }

  async setFontNameOfTabOfWindow(target_tab_required_string, target_window_required_string, value_required_text) {
    if (!target_tab_required_string || typeof target_tab_required_string !== "string") {
      throw new Error("target_tab_required_string is required and must be a string");
    }
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }
    if (value_required_text === undefined || value_required_text === null) {
      throw new Error("value_required_text is required");
    }

    const castedTab = castAndEscape(target_tab_required_string, 'string');
    const castedWindow = castAndEscape(target_window_required_string, 'string');
    const castedValue = castAndEscape(value_required_text, 'text');
    // Determine value format for AppleScript
    let valueForScript;
    if (typeof castedValue === 'string' && !castedValue.startsWith('{') && !castedValue.startsWith('date')) {
      valueForScript = `"${castedValue}"`; // Wrap strings in quotes
    } else {
      valueForScript = castedValue; // Use as-is for numbers, booleans, lists, records
    }

    const script = `
      tell application "Terminal"
        tell (${castedTab} of ${castedWindow})
          set font name of it to ${valueForScript}
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      message: "Property set successfully",
      value: value_required_text,
      script: script,
      tab: target_tab_required_string,
      window: target_window_required_string
    };
  }

  async getFontSizeOfTabOfWindow(target_tab_required_string, target_window_required_string) {
    if (!target_tab_required_string || typeof target_tab_required_string !== "string") {
      throw new Error("target_tab_required_string is required and must be a string");
    }
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }

    const escapedTab = escapeForAppleScript(target_tab_required_string);
    const escapedWindow = escapeForAppleScript(target_window_required_string);

    const script = `
      tell application "Terminal"
        tell (${escapedTab} of ${escapedWindow})
          return font size of it
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      value: result,
      script: script,
      tab: target_tab_required_string,
      window: target_window_required_string
    };
  }

  async setFontSizeOfTabOfWindow(target_tab_required_string, target_window_required_string, value_required_integer) {
    if (!target_tab_required_string || typeof target_tab_required_string !== "string") {
      throw new Error("target_tab_required_string is required and must be a string");
    }
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }
    if (value_required_integer === undefined || value_required_integer === null) {
      throw new Error("value_required_integer is required");
    }

    const castedTab = castAndEscape(target_tab_required_string, 'string');
    const castedWindow = castAndEscape(target_window_required_string, 'string');
    const castedValue = castAndEscape(value_required_integer, 'integer');
    // Determine value format for AppleScript
    let valueForScript;
    if (typeof castedValue === 'string' && !castedValue.startsWith('{') && !castedValue.startsWith('date')) {
      valueForScript = `"${castedValue}"`; // Wrap strings in quotes
    } else {
      valueForScript = castedValue; // Use as-is for numbers, booleans, lists, records
    }

    const script = `
      tell application "Terminal"
        tell (${castedTab} of ${castedWindow})
          set font size of it to ${valueForScript}
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      message: "Property set successfully",
      value: value_required_integer,
      script: script,
      tab: target_tab_required_string,
      window: target_window_required_string
    };
  }

  async getFontAntialiasingOfTabOfWindow(target_tab_required_string, target_window_required_string) {
    if (!target_tab_required_string || typeof target_tab_required_string !== "string") {
      throw new Error("target_tab_required_string is required and must be a string");
    }
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }

    const escapedTab = escapeForAppleScript(target_tab_required_string);
    const escapedWindow = escapeForAppleScript(target_window_required_string);

    const script = `
      tell application "Terminal"
        tell (${escapedTab} of ${escapedWindow})
          return font antialiasing of it
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      value: result,
      script: script,
      tab: target_tab_required_string,
      window: target_window_required_string
    };
  }

  async setFontAntialiasingOfTabOfWindow(target_tab_required_string, target_window_required_string, value_required_boolean) {
    if (!target_tab_required_string || typeof target_tab_required_string !== "string") {
      throw new Error("target_tab_required_string is required and must be a string");
    }
    if (!target_window_required_string || typeof target_window_required_string !== "string") {
      throw new Error("target_window_required_string is required and must be a string");
    }
    if (value_required_boolean === undefined || value_required_boolean === null) {
      throw new Error("value_required_boolean is required");
    }

    const castedTab = castAndEscape(target_tab_required_string, 'string');
    const castedWindow = castAndEscape(target_window_required_string, 'string');
    const castedValue = castAndEscape(value_required_boolean, 'boolean');
    // Determine value format for AppleScript
    let valueForScript;
    if (typeof castedValue === 'string' && !castedValue.startsWith('{') && !castedValue.startsWith('date')) {
      valueForScript = `"${castedValue}"`; // Wrap strings in quotes
    } else {
      valueForScript = castedValue; // Use as-is for numbers, booleans, lists, records
    }

    const script = `
      tell application "Terminal"
        tell (${castedTab} of ${castedWindow})
          set font antialiasing of it to ${valueForScript}
        end tell
      end tell
    `;

    const result = await executeAppleScript(script);
    return {
      success: result !== "Error",
      message: "Property set successfully",
      value: value_required_boolean,
      script: script,
      tab: target_tab_required_string,
      window: target_window_required_string
    };
  }

  sendResponse(response) {
    const responseStr = JSON.stringify(response);
    console.error("Sending response:", response.method || 'result', response.id);
    process.stdout.write(responseStr + '\n');
  }
}

// Start the server
async function startServer() {
  console.error("Testing Terminal availability...");
  await checkTerminalAvailable();
  
  console.error("Creating Terminal MCP server...");
  const server = new TerminalMCPServer();
  
  console.error("Terminal AppleScript MCP server running on stdio");
  
  // Keep the process alive
  process.on('SIGINT', () => {
    console.error("Shutting down Terminal AppleScript MCP server");
    process.exit(0);
  });
  
  process.on('SIGTERM', () => {
    console.error("Shutting down Terminal AppleScript MCP server");
    process.exit(0);
  });
}

startServer().catch(error => {
  console.error("Fatal error starting server:", error);
  process.exit(1);
});
