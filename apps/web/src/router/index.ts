import { createRouter, createWebHistory } from 'vue-router';
import ChannelPage from '@/pages/ChannelPage.vue';
import HomePage from '@/pages/HomePage.vue';
import PlaylistPage from '@/pages/PlaylistPage.vue';
import SearchPage from '@/pages/SearchPage.vue';
import WatchPage from '@/pages/WatchPage.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      component: HomePage,
      meta: { shellMode: 'browse' },
    },
    {
      path: '/results',
      name: 'search',
      component: SearchPage,
      meta: { shellMode: 'browse' },
    },
    {
      path: '/watch',
      name: 'watch',
      component: WatchPage,
      meta: { shellMode: 'watch' },
    },
    {
      path: '/channel/:channelId',
      name: 'channel',
      component: ChannelPage,
      meta: { shellMode: 'browse' },
    },
    {
      path: '/playlist/:playlistId',
      name: 'playlist',
      component: PlaylistPage,
      meta: { shellMode: 'browse' },
    },
  ],
  scrollBehavior() {
    return { top: 0 };
  },
});
