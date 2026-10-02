import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Footer } from '../components/layout/Footer';
import { NotFoundPage } from '../features/errors/NotFoundPage';

describe('Layout Components', () => {
  describe('Footer', () => {
    it('renders copyright with current year and Contact Developer link', () => {
      render(
        <MemoryRouter>
          <Footer />
        </MemoryRouter>
      );
      const year = new Date().getFullYear();
      expect(screen.getByText(new RegExp(`©\\s*${year}\\s*Bright Cloud`))).toBeDefined();
      const contactLink = screen.getByRole('link', { name: /contact developer/i });
      expect(contactLink).toBeDefined();
      expect(contactLink.getAttribute('href')).toBe('/contact-developer');
    });
  });

  describe('NotFoundPage', () => {
    it('renders 404 heading, message, and return to dashboard button', () => {
      render(
        <MemoryRouter>
          <NotFoundPage />
        </MemoryRouter>
      );

      expect(screen.getByText('404')).toBeDefined();
      expect(screen.getByText(/page not found/i)).toBeDefined();
      expect(screen.getByRole('button', { name: /dashboard/i })).toBeDefined();
    });
  });

  describe('ContactDeveloperPage', () => {
    it('renders Instagram and Discord external links with noopener noreferrer and official SVGs', async () => {
      const { ContactDeveloperPage, INSTAGRAM_URL, DISCORD_URL } = await import('../features/contact/ContactDeveloperPage');
      render(
        <MemoryRouter>
          <ContactDeveloperPage />
        </MemoryRouter>
      );

      expect(screen.getByRole('heading', { name: /contact developer/i })).toBeDefined();

      const igLink = screen.getByRole('link', { name: /instagram/i });
      expect(igLink).toBeDefined();
      expect(igLink.getAttribute('href')).toBe(INSTAGRAM_URL);
      expect(igLink.getAttribute('target')).toBe('_blank');
      expect(igLink.getAttribute('rel')).toContain('noopener');
      expect(igLink.getAttribute('rel')).toContain('noreferrer');

      const discordLink = screen.getByRole('link', { name: /discord/i });
      expect(discordLink).toBeDefined();
      expect(discordLink.getAttribute('href')).toBe(DISCORD_URL);
      expect(discordLink.getAttribute('target')).toBe('_blank');
      expect(discordLink.getAttribute('rel')).toContain('noopener');
      expect(discordLink.getAttribute('rel')).toContain('noreferrer');
    });
  });
});
