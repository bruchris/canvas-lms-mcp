/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * This file is produced by scripts/canvas-spec/generate.ts from the
 * hand-authored prototype spec in spec/canvas/prototype.yaml, with
 * overlays from spec/canvas/overrides/*.yaml applied on top.
 *
 * To regenerate:
 *
 *   pnpm canvas:spec:generate
 *
 * The generated types stay license-clean because the source spec is
 * hand-authored from public Canvas API documentation. When the license
 * decision from issue #78 is resolved and the full Canvas spec is wired
 * in as the source, this banner should be revisited.
 */

/* prettier-ignore */
export interface paths {
    readonly "/api/v1/users/{id}": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Get a single user */
        readonly get: operations["showUser"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/users/self/profile": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Get current user profile */
        readonly get: operations["showSelfProfile"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/users/self/upcoming_events": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** List current user upcoming events */
        readonly get: operations["listSelfUpcomingEvents"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/courses/{course_id}/users": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** List users enrolled in a course */
        readonly get: operations["listCourseUsers"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/api/v1/accounts/{account_id}/users": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** List/search users in an account */
        readonly get: operations["listAccountUsers"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
}
export type webhooks = Record<string, never>
export interface components {
  schemas: {
    readonly User: {
      /** Format: int64 */
      readonly id: number
      readonly name?: string
      readonly sortable_name?: string
      readonly short_name?: string
      readonly sis_user_id?: string | null
      readonly integration_id?: string | null
      readonly sis_import_id?: number | null
      readonly login_id?: string
      readonly avatar_url?: string
      readonly enrollments?: readonly components['schemas']['Enrollment'][]
      readonly email?: string
      readonly locale?: string | null
      /** Format: date-time */
      readonly last_login?: string | null
      readonly time_zone?: string
      readonly bio?: string | null
      readonly primary_email?: string
    }
    readonly UserProfile: {
      /** Format: int64 */
      readonly id: number
      readonly name?: string
      readonly short_name?: string
      readonly sortable_name?: string
      readonly title?: string | null
      readonly bio?: string | null
      readonly primary_email?: string
      readonly login_id?: string
      readonly sis_user_id?: string | null
      readonly lti_user_id?: string | null
      readonly avatar_url?: string
      readonly calendar?: {
        readonly ics?: string
      }
      readonly time_zone?: string
      readonly locale?: string
    }
    readonly Enrollment: {
      readonly id: number
      readonly course_id: number
      readonly type: string
      readonly role?: string
      readonly enrollment_state?: string
    }
    readonly UpcomingEvent: {
      readonly id: number | string
      readonly title?: string
      /** Format: date-time */
      readonly start_at?: string | null
      /** Format: date-time */
      readonly end_at?: string | null
      readonly type?: string
      readonly html_url?: string
      readonly assignment?: Record<string, never>
    }
  }
  responses: never
  parameters: {
    readonly PerPage: number
  }
  requestBodies: never
  headers: never
  pathItems: never
}
export type $defs = Record<string, never>
export interface operations {
  readonly showUser: {
    readonly parameters: {
      readonly query?: never
      readonly header?: never
      readonly path: {
        readonly id: number | string
      }
      readonly cookie?: never
    }
    readonly requestBody?: never
    readonly responses: {
      /** @description User */
      readonly 200: {
        headers: {
          readonly [name: string]: unknown
        }
        content: {
          readonly 'application/json': components['schemas']['User']
        }
      }
    }
  }
  readonly showSelfProfile: {
    readonly parameters: {
      readonly query?: never
      readonly header?: never
      readonly path?: never
      readonly cookie?: never
    }
    readonly requestBody?: never
    readonly responses: {
      /** @description UserProfile */
      readonly 200: {
        headers: {
          readonly [name: string]: unknown
        }
        content: {
          readonly 'application/json': components['schemas']['UserProfile']
        }
      }
    }
  }
  readonly listSelfUpcomingEvents: {
    readonly parameters: {
      readonly query?: {
        readonly type?: 'Assignment' | 'Event'
      }
      readonly header?: never
      readonly path?: never
      readonly cookie?: never
    }
    readonly requestBody?: never
    readonly responses: {
      /** @description List of upcoming events */
      readonly 200: {
        headers: {
          readonly [name: string]: unknown
        }
        content: {
          readonly 'application/json': readonly components['schemas']['UpcomingEvent'][]
        }
      }
    }
  }
  readonly listCourseUsers: {
    readonly parameters: {
      readonly query?: {
        readonly per_page?: components['parameters']['PerPage']
        readonly search_term?: string
        readonly sort?: 'username' | 'email' | 'sis_id' | 'integration_id' | 'last_login'
        readonly order?: 'asc' | 'desc'
        readonly enrollment_role_id?: number
        readonly user_id?: number | string
        readonly 'enrollment_type[]'?: readonly (
          | 'student'
          | 'teacher'
          | 'ta'
          | 'observer'
          | 'designer'
        )[]
        readonly 'enrollment_state[]'?: readonly (
          | 'active'
          | 'invited'
          | 'rejected'
          | 'completed'
          | 'inactive'
        )[]
        readonly 'include[]'?: readonly (
          | 'email'
          | 'enrollments'
          | 'locked'
          | 'avatar_url'
          | 'test_student'
          | 'bio'
          | 'custom_links'
          | 'current_grading_period_scores'
        )[]
        readonly 'user_ids[]'?: readonly (number | string)[]
      }
      readonly header?: never
      readonly path: {
        readonly course_id: number | string
      }
      readonly cookie?: never
    }
    readonly requestBody?: never
    readonly responses: {
      /** @description List of users */
      readonly 200: {
        headers: {
          readonly [name: string]: unknown
        }
        content: {
          readonly 'application/json': readonly components['schemas']['User'][]
        }
      }
    }
  }
  readonly listAccountUsers: {
    readonly parameters: {
      readonly query?: {
        readonly per_page?: components['parameters']['PerPage']
        readonly search_term?: string
        readonly sort?: 'username' | 'email' | 'sis_id' | 'integration_id' | 'last_login'
        readonly order?: 'asc' | 'desc'
        readonly 'include[]'?: readonly (
          | 'email'
          | 'last_login'
          | 'avatar_url'
          | 'time_zone'
          | 'uuid'
        )[]
      }
      readonly header?: never
      readonly path: {
        readonly account_id: number | string
      }
      readonly cookie?: never
    }
    readonly requestBody?: never
    readonly responses: {
      /** @description List of users */
      readonly 200: {
        headers: {
          readonly [name: string]: unknown
        }
        content: {
          readonly 'application/json': readonly components['schemas']['User'][]
        }
      }
    }
  }
}
