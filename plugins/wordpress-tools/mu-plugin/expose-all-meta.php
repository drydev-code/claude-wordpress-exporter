<?php
/**
 * Plugin Name: Expose All Meta and Options to REST API
 * Description: Exposes all post meta and plugin options to the REST API for wp-content-sync export
 * Version: 1.1.0
 */

add_action('rest_api_init', function() {
    // Expose all meta for posts and pages
    register_rest_field(
        ['post', 'page'],
        'all_meta',
        [
            'get_callback' => function($post) {
                $meta = get_post_meta($post['id']);
                $result = [];
                foreach ($meta as $key => $values) {
                    if (strpos($key, '_edit_') === 0 || strpos($key, '_wp_') === 0) {
                        continue;
                    }
                    $result[$key] = count($values) === 1 ? maybe_unserialize($values[0]) : array_map('maybe_unserialize', $values);
                }
                return $result;
            },
            'update_callback' => function($value, $post) {
                if (!is_array($value)) return;
                foreach ($value as $key => $val) {
                    update_post_meta($post->ID, $key, $val);
                }
            },
            'schema' => ['type' => 'object']
        ]
    );

    // Expose all meta for custom post types (CF7, ACF, etc.)
    $custom_post_types = ['wpcf7_contact_form', 'acf-field-group', 'wpforms', 'frm_form'];
    foreach ($custom_post_types as $post_type) {
        if (post_type_exists($post_type)) {
            register_rest_field(
                $post_type,
                'all_meta',
                [
                    'get_callback' => function($post) {
                        $meta = get_post_meta($post['id']);
                        $result = [];
                        foreach ($meta as $key => $values) {
                            $result[$key] = count($values) === 1 ? maybe_unserialize($values[0]) : array_map('maybe_unserialize', $values);
                        }
                        return $result;
                    },
                    'schema' => ['type' => 'object']
                ]
            );
        }
    }
});

// Enable Application Passwords on non-SSL (for local development)
add_filter('wp_is_application_passwords_available', '__return_true');
